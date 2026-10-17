import {
  BlockAssembler,
  contentHasFile,
  contentHasImage,
  projectFilesToText,
  projectImagesForTextModel,
  projectToolUpdates,
  type ContentBlock,
  type LlmRuntime,
  type PreparedLlmCall,
  type RequestMessage,
  type ToolSchema,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type { BtwCacheStrategy } from '../shared/protocol.js'
import type { BtwContextSnapshot } from './context-snapshot.js'
import { btwPiAiAdapter } from './btw-pi-ai-adapter.js'
import { SessionId } from '@deepseek-ai/dsh-session/types'

export interface BtwOneShotResult {
  readonly response: string
  readonly usage?: TokenUsage
  readonly cacheStrategy: BtwCacheStrategy
  readonly finishKind: string
}

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .filter(text => text.trim().length > 0)
    .join('\n\n')
    .trim()
}

function toolOnlyFallback(blocks: readonly ContentBlock[]): string | undefined {
  const call = blocks.find((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call')
  if (call === undefined) return undefined
  const name = call.name.trim() === '' ? 'a tool' : call.name
  return `(The model tried to call ${name} instead of answering directly. Try rephrasing or ask in the main conversation.)`
}

/**
 * Resolve one durable file reference through the runtime's read path.
 * `LlmRuntime.fileReadPath` is an implementation detail; a missing resolver
 * still lets projectFilesToText emit its documented "cannot access" handle.
 */
function resolveFilePath(llm: LlmRuntime, ref: unknown): string | undefined {
  const runtime = llm as unknown as {
    fileReadPath?: (reference: unknown) => string | undefined
  }
  try {
    return runtime.fileReadPath?.(ref)
  } catch {
    return undefined
  }
}

/**
 * Re-apply the request projections `LlmRuntime` performs before adapter
 * dispatch. The pi-ai cache bridge calls its per-call adapter directly (to
 * install onPayload), so it must reproduce the same message/tool view the
 * parent request would have dispatched.
 *
 * The replay-state filter (`forAdapter`) is intentionally omitted: the BTW
 * adapter is a per-call delegate of the same provider family as the registered
 * adapter, and filtering by delegate identity would strip valid replay state.
 */
function projectForAdapter(
  llm: LlmRuntime,
  prepared: PreparedLlmCall,
  snapshot: BtwContextSnapshot,
): { messages: RequestMessage[]; tools?: ToolSchema[] } {
  let messages: readonly RequestMessage[] = snapshot.messages
  if (messages.some(message => contentHasFile(message.content))) {
    messages = projectFilesToText(messages, ref => resolveFilePath(llm, ref))
  }
  if (
    prepared.inputModalities !== undefined
    && !prepared.inputModalities.includes('image')
    && messages.some(message => contentHasImage(message.content))
  ) {
    messages = projectImagesForTextModel(messages)
  }
  const projected = projectToolUpdates(
    messages,
    snapshot.tools,
    prepared.toolUpdate,
    snapshot.toolHistory,
  )
  return {
    messages: [...projected.messages],
    ...(projected.tools === undefined ? {} : { tools: [...projected.tools] }),
  }
}

export async function runBtwOneShot(
  llm: LlmRuntime,
  snapshot: BtwContextSnapshot,
  sidechainId: string,
  signal: AbortSignal,
): Promise<BtwOneShotResult> {
  let markerMoved = false
  const piAi = btwPiAiAdapter(llm, snapshot.config.provider, () => { markerMoved = true })
  const prepared = await llm.prepareCall(snapshot.config, signal)
  const common = {
    messages: snapshot.messages as RequestMessage[],
    ...(snapshot.system === undefined ? {} : { system: snapshot.system }),
    toolHistory: snapshot.toolHistory,
    sessionId: SessionId(sidechainId),
    signal,
  }

  let stream
  if (piAi !== undefined) {
    const projected = projectForAdapter(llm, prepared, snapshot)
    stream = piAi.stream({
      ...prepared.config,
      ...common,
      messages: projected.messages,
      ...(projected.tools === undefined ? {} : { tools: projected.tools }),
    })
  } else {
    stream = prepared.stream({
      ...prepared.config,
      ...common,
      ...(snapshot.tools === undefined ? {} : { tools: snapshot.tools }),
    })
  }

  const assembler = new BlockAssembler()
  for await (const chunk of stream) assembler.push(chunk)
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    const message = finish.failure.message || `LLM request ${finish.kind}`
    throw new Error(message)
  }
  const blocks = assembler.blocks()
  const response = textOf(blocks) || toolOnlyFallback(blocks)
  if (response === undefined) throw new Error('No response received')
  return {
    response,
    ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
    cacheStrategy: markerMoved ? 'anthropic-shared-prefix' : 'provider-managed',
    finishKind: finish.kind,
  }
}
