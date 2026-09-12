import { SessionId } from "@deepseek-ai/dsh-session";
import schema from "@deepseek-ai/schemastery";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { SessionId as SessionId$1 } from "@deepseek-ai/dsh-session/types";
import { appendFile, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { clientRequestSchema } from "@deepseek-ai/dsh-client-connection";

//#region src/shared/protocol.ts
const BTW_RPC_CHANNEL = "/api";
const BTW_ASK_ENDPOINT = "dsh-btw/ask";
function readAskRequest(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const source = value;
	if (typeof source.requestId !== "string" || source.requestId.length === 0 || source.requestId.length > 128) return void 0;
	if (typeof source.sessionId !== "string" || source.sessionId.length === 0 || source.sessionId.length > 256) return void 0;
	if (typeof source.question !== "string") return void 0;
	const question = source.question.trim();
	if (question.length === 0 || question.length > 32e3) return void 0;
	return {
		requestId: source.requestId,
		sessionId: source.sessionId,
		question
	};
}

//#endregion
//#region src/host/context-snapshot.ts
const BTW_REMINDER = `<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>`;
/** Longest prefix that does not leave an assistant tool call without its result. */
function balancedMessagePrefix(messages) {
	const pending = /* @__PURE__ */ new Set();
	let lastBalanced = 0;
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message === void 0) continue;
		for (const block of message.content) {
			if (message.role === "assistant" && block.type === "tool-call") pending.add(String(block.id));
			if (message.role === "user" && block.type === "tool-result") pending.delete(String(block.toolCallId));
		}
		if (pending.size === 0) lastBalanced = index + 1;
	}
	return messages.slice(0, lastBalanced);
}
function wrapQuestion(question) {
	return `${BTW_REMINDER}\n\n${question}`;
}
function snapshotContext(agent, question) {
	const header = agent.session.requestHeader();
	if (header === void 0) throw new Error("No model request context exists yet. Send one main-conversation message before using /btw.");
	const sharedMessages = balancedMessagePrefix(agent.session.deriveMessages());
	const sideQuestion = createUserMessage({
		content: [{
			type: "text",
			text: wrapQuestion(question)
		}],
		source: { kind: "user" }
	});
	return {
		parentSessionId: String(agent.session.id),
		config: structuredClone(header.config),
		...header.tools === void 0 ? {} : { tools: structuredClone(header.tools) },
		sharedMessages,
		messages: [...sharedMessages, sideQuestion]
	};
}

//#endregion
//#region src/host/cache-boundary.ts
function object(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function takeTailCacheControl(message) {
	if (!Array.isArray(message.content)) return void 0;
	let found;
	for (const value of message.content) {
		const block = object(value);
		if (block === void 0 || block.cache_control === void 0) continue;
		found ??= block.cache_control;
		delete block.cache_control;
	}
	return found;
}
function markMessage(message, cacheControl) {
	if (typeof message.content === "string" && message.content.length > 0) {
		message.content = [{
			type: "text",
			text: message.content,
			cache_control: cacheControl
		}];
		return true;
	}
	if (!Array.isArray(message.content)) return false;
	for (let index = message.content.length - 1; index >= 0; index--) {
		const block = object(message.content[index]);
		if (block === void 0) continue;
		const type = block.type;
		if (type === "text" || type === "image" || type === "tool_result" || type === "tool_use" || type === "thinking" || type === "redacted_thinking") {
			block.cache_control = cacheControl;
			return true;
		}
	}
	return false;
}
/**
* pi-ai marks the final user block. A fire-and-forget BTW tail has no future
* consumer, so move that marker to the last cacheable block in the shared
* prefix. The input object is never mutated.
*/
function shiftAnthropicCacheBoundary(payload) {
	const root = object(payload);
	if (root === void 0 || !Array.isArray(root.messages) || root.messages.length < 2) return {
		payload,
		moved: false
	};
	const cloned = structuredClone(root);
	const messages = cloned.messages;
	const tail = object(messages.at(-1));
	if (tail === void 0) return {
		payload,
		moved: false
	};
	const cacheControl = takeTailCacheControl(tail);
	if (cacheControl === void 0) return {
		payload,
		moved: false
	};
	for (let index = messages.length - 2; index >= 0; index--) {
		const candidate = object(messages[index]);
		if (candidate !== void 0 && markMessage(candidate, cacheControl)) return {
			payload: cloned,
			moved: true
		};
	}
	return {
		payload,
		moved: false
	};
}

//#endregion
//#region src/host/btw-pi-ai-adapter.ts
/**
* Narrow, version-pinned derivative of DSH's public PiAiAdapter. Each call gets
* its own delegate and Models collection, then adds pi-ai's public onPayload
* hook without mutating the deployment's registered adapter.
*/
var BtwPiAiAdapter = class extends PiAiAdapter {
	constructor(btwOptions, onBoundaryMoved) {
		super(btwOptions);
		this.btwOptions = btwOptions;
		this.onBoundaryMoved = onBoundaryMoved;
	}
	async *stream(options) {
		const profiles = this.btwOptions.profiles();
		const delegate = new PiAiAdapter({
			...this.btwOptions,
			profiles: () => profiles
		});
		const internal$1 = delegate;
		if (typeof internal$1.current !== "function") throw new Error("dsh-btw: incompatible PiAiAdapter internals (expected 0.1.5-rc.2 current())");
		const models = internal$1.current.call(delegate).models;
		if (typeof models?.streamSimple !== "function") throw new Error("dsh-btw: incompatible PiAiAdapter internals (expected Models.streamSimple())");
		const original = models.streamSimple.bind(models);
		models.streamSimple = (...args) => {
			const rawOptions = typeof args[2] === "object" && args[2] !== null ? args[2] : {};
			const upstream = typeof rawOptions.onPayload === "function" ? rawOptions.onPayload : void 0;
			args[2] = {
				...rawOptions,
				onPayload: async (payload, model) => {
					const upstreamValue = upstream === void 0 ? void 0 : await upstream(payload, model);
					const effective = upstreamValue === void 0 ? payload : upstreamValue;
					if ((typeof model === "object" && model !== null ? model.api : void 0) !== "anthropic-messages") return effective;
					const shifted = shiftAnthropicCacheBoundary(effective);
					if (shifted.moved) this.onBoundaryMoved();
					return shifted.payload;
				}
			};
			return original(...args);
		};
		yield* delegate.stream(options);
	}
};
/**
* Read only the constructor hooks of the registered 0.1.5-rc.2 pi-ai
* adapter. No registry entry or live adapter is changed. Other adapters use
* the public LlmRuntime fallback.
*/
function btwPiAiAdapter(runtime, provider, onBoundaryMoved) {
	const candidate = runtime.adapters?.get(provider)?.adapter;
	if (candidate === void 0) return void 0;
	const internal$1 = candidate;
	if (!(candidate instanceof PiAiAdapter || candidate.constructor?.name === "PiAiAdapter")) return void 0;
	if (internal$1.config === void 0 || typeof internal$1.config.profiles !== "function" || typeof internal$1.config.resolveApiKey !== "function" || internal$1.config.auth?.credentials === void 0 || internal$1.config.auth.authContext === void 0) throw new Error("dsh-btw: incompatible PiAiAdapter constructor hooks (expected 0.1.5-rc.2 auth injection)");
	return new BtwPiAiAdapter(internal$1.config, onBoundaryMoved);
}

//#endregion
//#region src/host/one-shot.ts
function textOf(blocks) {
	return blocks.filter((block) => block.type === "text").map((block) => block.text).filter((text) => text.trim().length > 0).join("\n\n").trim();
}
function toolOnlyFallback(blocks) {
	const call = blocks.find((block) => block.type === "tool-call");
	if (call === void 0) return void 0;
	return `(The model tried to call ${call.name.trim() === "" ? "a tool" : call.name} instead of answering directly. Try rephrasing or ask in the main conversation.)`;
}
async function runBtwOneShot(llm, snapshot, sidechainId, signal) {
	let markerMoved = false;
	const piAi = btwPiAiAdapter(llm, snapshot.config.provider, () => {
		markerMoved = true;
	});
	const requestBase = {
		messages: snapshot.messages,
		...snapshot.system === void 0 ? {} : { system: snapshot.system },
		...snapshot.tools === void 0 ? {} : { tools: snapshot.tools },
		sessionId: SessionId$1(sidechainId),
		signal
	};
	let stream;
	if (piAi !== void 0) stream = piAi.stream({
		...snapshot.config,
		...requestBase
	});
	else {
		const prepared = await llm.prepareCall(snapshot.config, signal);
		stream = prepared.stream({
			...prepared.config,
			...requestBase
		});
	}
	const assembler = new BlockAssembler();
	for await (const chunk of stream) assembler.push(chunk);
	const finish = assembler.finish;
	if (finish.kind === "error" || finish.kind === "aborted") {
		const message = finish.failure.message || `LLM request ${finish.kind}`;
		throw new Error(message);
	}
	const blocks = assembler.blocks();
	const response = textOf(blocks) || toolOnlyFallback(blocks);
	if (response === void 0) throw new Error("No response received");
	return {
		response,
		...assembler.usage === void 0 ? {} : { usage: assembler.usage },
		cacheStrategy: markerMoved ? "anthropic-shared-prefix" : "provider-managed",
		finishKind: finish.kind
	};
}

//#endregion
//#region src/host/sidechain-kernel.ts
const PRIVATE_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/iu;
var PrivateSidechainKernel = class {
	mode;
	root;
	retentionMs;
	maxSessions;
	memory = /* @__PURE__ */ new Map();
	constructor(config = {}) {
		this.mode = config.mode ?? "private-jsonl";
		this.root = resolve(config.root ?? join(resolveDshHome(), "btw-sidechains", "v1"));
		this.retentionMs = (config.retentionDays ?? 7) * 24 * 60 * 60 * 1e3;
		this.maxSessions = config.maxSessions ?? 500;
	}
	createId() {
		return randomUUID();
	}
	async begin(question, request, sidechainId = this.createId()) {
		if (this.mode === "none") return sidechainId;
		const start = {
			version: 1,
			type: "start",
			sidechainId,
			parentSessionId: request.parentSessionId,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			question,
			request
		};
		if (this.mode === "memory") {
			this.memory.set(sidechainId, { start });
			this.pruneMemory();
			return sidechainId;
		}
		await mkdir(this.root, {
			recursive: true,
			mode: 448
		});
		await writeFile(this.filename(sidechainId), `${JSON.stringify(start)}\n`, {
			flag: "wx",
			mode: 384
		});
		return sidechainId;
	}
	async finish(sidechainId, outcome) {
		if (this.mode === "none") return;
		const end = {
			version: 1,
			type: "end",
			sidechainId,
			completedAt: (/* @__PURE__ */ new Date()).toISOString(),
			outcome
		};
		if (this.mode === "memory") {
			const transcript = this.memory.get(sidechainId);
			if (transcript !== void 0) transcript.end = end;
			return;
		}
		await appendFile(this.filename(sidechainId), `${JSON.stringify(end)}\n`, { encoding: "utf8" });
		await this.pruneFiles();
	}
	filename(sidechainId) {
		return join(this.root, `${sidechainId}.jsonl`);
	}
	pruneMemory() {
		while (this.memory.size > this.maxSessions) {
			const oldest = this.memory.keys().next().value;
			if (oldest === void 0) return;
			this.memory.delete(oldest);
		}
	}
	async pruneFiles() {
		const names = (await readdir(this.root)).filter((name$1) => PRIVATE_FILE.test(name$1));
		const rows = await Promise.all(names.map(async (name$1) => ({
			name: name$1,
			info: await stat(join(this.root, name$1))
		})));
		rows.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);
		const now = Date.now();
		const removals = rows.filter((row, index) => index >= this.maxSessions || now - row.info.mtimeMs > this.retentionMs);
		await Promise.all(removals.map((row) => unlink(join(this.root, row.name))));
	}
};

//#endregion
//#region src/host/rpc-route.ts
/** Add one plugin-owned endpoint to the authenticated shared carrier. */
function createBtwRpcRoute(handler) {
	return {
		path: `${BTW_RPC_CHANNEL}/${BTW_ASK_ENDPOINT}`,
		methods: ["POST"],
		requestBody: "buffered",
		async fetch(request) {
			if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
			if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return new Response("content type must be application/json", { status: 415 });
			let body;
			try {
				body = await request.json();
			} catch {
				return new Response("body is not JSON", { status: 400 });
			}
			const envelope = clientRequestSchema.safeParse(body);
			if (!envelope.success) return new Response("invalid client-request envelope", { status: 400 });
			const { rpcId, method, payload } = envelope.data;
			if (method !== BTW_ASK_ENDPOINT) return Response.json({
				type: "server-response",
				rpcId,
				result: {
					ok: false,
					error: {
						code: "bad-request",
						message: "Unexpected BTW method.",
						details: {}
					}
				}
			});
			const result = await handler(method, payload, request.signal);
			return Response.json({
				type: "server-response",
				rpcId,
				result
			});
		}
	};
}

//#endregion
//#region src/host/service.ts
const sidechainSchema = schema.object({
	mode: schema.union([
		"private-jsonl",
		"memory",
		"none"
	]).default("private-jsonl"),
	root: schema.string(),
	retentionDays: schema.natural().min(1).default(7),
	maxSessions: schema.natural().min(1).default(500)
});
const Config = schema.object({
	timeoutMs: schema.natural().min(1).default(12e4),
	sidechain: sidechainSchema
});
function internal(message) {
	return {
		ok: false,
		error: {
			code: "internal",
			message,
			details: {}
		}
	};
}
function cancelled(message = "The side question was cancelled.") {
	return {
		ok: false,
		error: {
			code: "cancelled",
			message,
			details: {}
		}
	};
}
function warnTranscriptFailure(ctx, phase, error) {
	ctx.logger.warn(`dsh-btw: failed to ${phase} private sidechain transcript; the side answer is unaffected`);
	ctx.logger.warn(error);
}
function installBtwService(ctx, config = {}) {
	const timeoutMs = config.timeoutMs ?? 12e4;
	const sidechains = new PrivateSidechainKernel(config.sidechain);
	const connection = ctx.connection;
	ctx.effect(() => connection.fetch.register(createBtwRpcRoute(async (endpoint, payload, transportSignal) => {
		if (endpoint !== BTW_ASK_ENDPOINT) return {
			ok: false,
			error: {
				code: "bad-request",
				message: `Unknown BTW endpoint: ${endpoint}`,
				details: { issues: [] }
			}
		};
		const request = readAskRequest(payload);
		if (request === void 0) return {
			ok: false,
			error: {
				code: "bad-request",
				message: "Invalid /btw request.",
				details: { issues: [] }
			}
		};
		const agent = ctx.agents.get(SessionId(request.sessionId));
		if (agent === void 0) return {
			ok: false,
			error: {
				code: "session-not-found",
				message: `No live agent owns session "${request.sessionId}".`,
				details: { sessionId: SessionId(request.sessionId) }
			}
		};
		const timeout = AbortSignal.timeout(timeoutMs);
		const signal = AbortSignal.any([transportSignal, timeout]);
		let sidechainId;
		let transcriptStarted = false;
		try {
			signal.throwIfAborted();
			const snapshot = snapshotContext(agent, request.question);
			sidechainId = sidechains.createId();
			try {
				await sidechains.begin(request.question, snapshot, sidechainId);
				transcriptStarted = true;
			} catch (writeError) {
				warnTranscriptFailure(ctx, "open", writeError);
			}
			const result = await ctx.agents.withInitiator(agent, () => runBtwOneShot(ctx.llm, snapshot, sidechainId, signal));
			if (transcriptStarted) try {
				await sidechains.finish(sidechainId, {
					kind: "success",
					result
				});
			} catch (writeError) {
				warnTranscriptFailure(ctx, "close", writeError);
			}
			return {
				ok: true,
				value: {
					requestId: request.requestId,
					sidechainId,
					response: result.response,
					cacheStrategy: result.cacheStrategy,
					...result.usage === void 0 ? {} : { usage: result.usage }
				}
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (sidechainId !== void 0 && transcriptStarted) try {
				await sidechains.finish(sidechainId, {
					kind: "error",
					message
				});
			} catch (writeError) {
				warnTranscriptFailure(ctx, "close", writeError);
			}
			if (transportSignal.aborted) return cancelled();
			if (timeout.aborted) return internal(`The side question timed out after ${timeoutMs} ms.`);
			return internal(message);
		}
	})));
}

//#endregion
//#region src/index.ts
const name = "btw";
const inject = [
	"agents",
	"connection",
	"llm"
];
function apply(ctx, config) {
	installBtwService(ctx, config);
}

//#endregion
export { Config, apply, inject, name };
//# sourceMappingURL=index.js.map