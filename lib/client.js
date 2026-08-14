window.__ModuleLoader__.load({ id: "dsh-btw", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let __deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
__deepseek_ai_dsh_client_runtime_client = __toESM(__deepseek_ai_dsh_client_runtime_client);
let react = require("react");
react = __toESM(react);
let __deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
__deepseek_ai_dsh_client_ui_primitives = __toESM(__deepseek_ai_dsh_client_ui_primitives);
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);

//#region src/shared/protocol.ts
const BTW_RPC_CHANNEL = "/btw-rpc";
const BTW_ASK_ENDPOINT = "ask";
function readAskResponse(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const source = value;
	if (typeof source.requestId !== "string" || typeof source.sidechainId !== "string" || typeof source.response !== "string") return;
	if (source.cacheStrategy !== "anthropic-shared-prefix" && source.cacheStrategy !== "provider-managed") return void 0;
	const usage = readUsage(source.usage);
	if (source.usage !== void 0 && usage === void 0) return void 0;
	return {
		requestId: source.requestId,
		sidechainId: source.sidechainId,
		response: source.response,
		cacheStrategy: source.cacheStrategy,
		...usage === void 0 ? {} : { usage }
	};
}
function readUsage(value) {
	if (value === void 0) return void 0;
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const source = value;
	if (!isCount(source.inputTokens) || !isCount(source.outputTokens)) return void 0;
	for (const key of [
		"cacheReadTokens",
		"cacheWriteTokens",
		"reasoningTokens"
	]) if (source[key] !== void 0 && !isCount(source[key])) return void 0;
	return source;
}
function isCount(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

//#endregion
//#region src/client/controller.ts
const CLOSED = { status: "closed" };
const CLIENT_RPC_TIMEOUT_MS = 125e3;
function requestId() {
	return globalThis.crypto?.randomUUID?.() ?? `btw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
var BtwController = class {
	state = (0, __deepseek_ai_dsh_client_runtime_client.createSnapshotStore)(CLOSED);
	active;
	disposed = false;
	constructor(connection, sessionId, timeoutMs = CLIENT_RPC_TIMEOUT_MS) {
		this.connection = connection;
		this.sessionId = sessionId;
		this.timeoutMs = timeoutMs;
	}
	ask(rawQuestion) {
		const question = rawQuestion.trim();
		if (question === "") return Promise.resolve({
			kind: "error",
			text: "Usage: /btw <your question>"
		});
		this.active?.abort();
		const controller = new AbortController();
		this.active = controller;
		this.state.set({
			status: "running",
			question
		});
		this.run(question, controller);
		return Promise.resolve({ kind: "success" });
	}
	async run(question, controller) {
		const timeout = AbortSignal.timeout(this.timeoutMs);
		const signal = AbortSignal.any([controller.signal, timeout]);
		try {
			const id = requestId();
			const result = await this.connection.rpc.call(BTW_RPC_CHANNEL, BTW_ASK_ENDPOINT, {
				requestId: id,
				sessionId: String(this.sessionId),
				question
			}, signal);
			if (this.disposed || controller.signal.aborted || this.active !== controller) return;
			if (!result.ok) {
				this.state.set({
					status: "error",
					question,
					error: result.error.message
				});
				return;
			}
			const response = readAskResponse(result.value);
			if (response === void 0 || response.requestId !== id) {
				this.state.set({
					status: "error",
					question,
					error: "The BTW host returned an invalid response."
				});
				return;
			}
			this.state.set({
				status: "success",
				question,
				response: response.response
			});
		} catch (error) {
			if (this.disposed || controller.signal.aborted || this.active !== controller) return;
			if (timeout.aborted) {
				this.state.set({
					status: "error",
					question,
					error: "The BTW request timed out."
				});
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			this.state.set({
				status: "error",
				question,
				error: message
			});
		} finally {
			if (this.active === controller) this.active = void 0;
		}
	}
	dismiss() {
		this.active?.abort();
		this.active = void 0;
		this.state.set(CLOSED);
	}
	dispose() {
		this.disposed = true;
		this.dismiss();
	}
};

//#endregion
//#region src/client/input-source.ts
function claim(controller, commandToken = "/btw") {
	return {
		token: `${commandToken} `,
		hint: "<your question>",
		submit: (args) => controller.ask(args)
	};
}
function enterClaim(controllerFor, sessionId, line) {
	const match = /^\s*(\/btw)\b/iu.exec(line);
	if (match?.[1] === void 0) return void 0;
	return { claim: claim(controllerFor(sessionId), match[1]) };
}
function createBtwInputSource(controllerFor) {
	return {
		trigger: "/",
		name: "btw",
		order: -10,
		candidates(_session, request) {
			if (request.position !== "leading" || !"btw".startsWith(request.query.toLowerCase())) return Promise.resolve([]);
			return Promise.resolve([{
				name: "btw",
				description: "Ask a side question without interrupting the main agent",
				hint: "<your question>"
			}]);
		},
		onPick(pick) {
			return { claim: claim(controllerFor(pick.session.sessionId)) };
		},
		matchSpace(session, token) {
			return /^\/btw$/iu.test(token) ? { claim: claim(controllerFor(session.sessionId), token) } : void 0;
		},
		matchEnter(session, line) {
			return Promise.resolve(enterClaim(controllerFor, session.sessionId, line));
		}
	};
}

//#endregion
//#region src/client/overlay.tsx
const dock = {
	boxSizing: "border-box",
	width: "calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))",
	maxWidth: "calc(var(--dsh-composer-card-max-width, 780px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))",
	margin: "0 auto",
	flex: "none"
};
const card = {
	position: "relative",
	boxSizing: "border-box",
	display: "flex",
	flexDirection: "column",
	gap: 10,
	width: "100%",
	maxHeight: "min(440px, 55vh)",
	overflow: "hidden",
	padding: "14px 16px",
	border: "1px solid var(--dsw-alias-border-l1, color-mix(in srgb, #d59d32 44%, transparent))",
	borderRadius: 12,
	background: "var(--dsw-specific-tip, var(--color-surface, #171717))",
	boxShadow: "0 14px 36px rgba(0, 0, 0, .24)",
	color: "var(--dsw-alias-label-primary, var(--color-text, inherit))",
	outline: "none"
};
const header = {
	display: "flex",
	alignItems: "baseline",
	gap: 8,
	minWidth: 0
};
const label = {
	color: "var(--dsw-alias-state-warn-label, var(--color-warning, #d59d32))",
	fontWeight: 700,
	flex: "0 0 auto"
};
const questionStyle = {
	minWidth: 0,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	opacity: .72
};
const body = {
	overflow: "auto",
	padding: "2px 2px 4px",
	lineHeight: 1.55
};
const footer = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: 12,
	fontSize: 12,
	opacity: .65
};
const button = {
	appearance: "none",
	border: "1px solid color-mix(in srgb, currentColor 24%, transparent)",
	borderRadius: 7,
	padding: "3px 9px",
	background: "transparent",
	color: "inherit",
	cursor: "pointer"
};
function BtwOverlay({ controller }) {
	const state = (0, react.useSyncExternalStore)((listener) => controller.state.subscribe(listener), () => controller.state.getSnapshot());
	const root = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		if (state.status !== "closed") root.current?.focus();
	}, [state.status]);
	(0, react.useEffect)(() => {
		if (state.status === "closed") return;
		const outside = (event) => {
			if (event.target instanceof Node && root.current?.contains(event.target)) return;
			controller.dismiss();
		};
		document.addEventListener("pointerdown", outside, true);
		return () => {
			document.removeEventListener("pointerdown", outside, true);
		};
	}, [state.status, controller]);
	if (state.status === "closed") return null;
	const onKeyDown = (event) => {
		if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			controller.dismiss();
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			root.current?.querySelector("[data-btw-body]")?.scrollBy({
				top: -90,
				behavior: "smooth"
			});
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			root.current?.querySelector("[data-btw-body]")?.scrollBy({
				top: 90,
				behavior: "smooth"
			});
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		style: dock,
		"data-btw-dock": true,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			ref: root,
			style: card,
			tabIndex: -1,
			role: "dialog",
			"aria-label": "BTW side question",
			onKeyDown,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: header,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: label,
						children: "/btw"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: questionStyle,
						title: state.question,
						children: state.question
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: body,
					"data-btw-body": true,
					children: [
						state.status === "running" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							role: "status",
							style: { color: "var(--dsw-alias-state-warn-label, var(--color-warning, #d59d32))" },
							children: "Answering…"
						}),
						state.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							role: "alert",
							style: { color: "var(--dsw-alias-state-error-primary, var(--color-error, #e06c75))" },
							children: state.error
						}),
						state.status === "success" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.MarkdownText, { text: state.response })
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: footer,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: state.status === "running" ? "The main agent keeps running" : "↑/↓ scroll · Enter, Space, or Esc dismiss" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: button,
						onClick: () => {
							controller.dismiss();
						},
						children: state.status === "running" ? "Cancel" : "Close"
					})]
				})
			]
		})
	});
}

//#endregion
//#region src/client/index.tsx
const name = "btw-client";
const inject = [
	"connection",
	"inputTriggers",
	"sessions",
	"slots"
];
function apply(ctx) {
	const connection = ctx.get("connection");
	const inputTriggers = ctx.get("inputTriggers");
	const sessions = ctx.get("sessions");
	if (connection === void 0 || inputTriggers === void 0 || sessions === void 0) throw new Error("dsh-btw/client requires connection, inputTriggers, and sessions");
	const controllers = /* @__PURE__ */ new Map();
	const boundScopes = /* @__PURE__ */ new Set();
	const controllerFor = (sessionId) => {
		let controller = controllers.get(sessionId);
		if (controller === void 0) {
			controller = new BtwController(connection, sessionId);
			controllers.set(sessionId, controller);
		}
		return controller;
	};
	ctx.effect(() => inputTriggers.registerSource(createBtwInputSource(controllerFor)), "dsh-btw: slash source");
	ctx.effect(() => () => {
		for (const controller of controllers.values()) controller.dispose();
		controllers.clear();
		boundScopes.clear();
	}, "dsh-btw: controller teardown");
	ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
		name: "conversation.input.dock",
		id: "btw-panel",
		order: 2,
		inject: (sessionId) => {
			const actx = sessions.scope(sessionId);
			if (actx === void 0) throw new Error(`dsh-btw: session "${String(sessionId)}" resolved no client scope`);
			const controller = controllerFor(sessionId);
			if (!boundScopes.has(sessionId)) {
				boundScopes.add(sessionId);
				actx.effect(() => () => {
					boundScopes.delete(sessionId);
					if (controllers.get(sessionId) === controller) controllers.delete(sessionId);
					controller.dispose();
				}, "dsh-btw: session controller");
			}
			return { controller };
		}
	}, BtwOverlay));
}

//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;
return module.exports; } });
//# sourceMappingURL=client.js.map