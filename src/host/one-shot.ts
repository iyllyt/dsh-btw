import { BlockAssembler, type ContentBlock, type LlmRuntime, type TokenUsage } from '@deepseek-ai/dsh-llm'
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

export async function runBtwOneShot(
  llm: LlmRuntime,
  snapshot: BtwContextSnapshot,
  sidechainId: string,
  signal: AbortSignal,
): Promise<BtwOneShotResult> {
  let markerMoved = false
  const piAi = btwPiAiAdapter(llm, snapshot.config.provider, () => { markerMoved = true })
  const requestBase = {
    messages: snapshot.messages,
    ...(snapshot.system === undefined ? {} : { system: snapshot.system }),
    ...(snapshot.tools === undefined ? {} : { tools: snapshot.tools }),
    sessionId: SessionId(sidechainId),
    signal,
  }

  let stream
  if (piAi !== undefined) {
    stream = piAi.stream({ ...snapshot.config, ...requestBase })
  } else {
    const prepared = await llm.prepareCall(snapshot.config, signal)
    stream = prepared.stream({ ...prepared.config, ...requestBase })
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
