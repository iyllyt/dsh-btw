import { CallId, type GenerateOptions, type LlmRuntime, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { runBtwOneShot } from '../src/host/one-shot.js'
import type { BtwContextSnapshot } from '../src/host/context-snapshot.js'

async function* chunks(): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: 'side ' }
  yield { type: 'text-delta', index: 0, text: 'answer' }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: 'side answer' } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

describe('runBtwOneShot', () => {
  it('dispatches one request with the exact header and tool catalog', async () => {
    let seen: GenerateOptions | undefined
    const llm = {
      prepareCall: async (config: BtwContextSnapshot['config']) => ({
        config,
        stream: (options: GenerateOptions) => {
          seen = options
          return chunks()
        },
      }),
    } as unknown as LlmRuntime
    const snapshot: BtwContextSnapshot = {
      parentSessionId: 'parent',
      config: { provider: 'mock', model: 'same', reasoningEffort: 'max' as never, temperature: 0.2 },
      system: 'byte-identical system',
      tools: [{ name: 'bash', description: 'shell', parameters: { type: 'object' } }],
      sharedMessages: [],
      messages: [],
    }
    const result = await runBtwOneShot(llm, snapshot, 'sidechain', new AbortController().signal)
    expect(result.response).toBe('side answer')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 })
    expect(seen).toMatchObject({
      provider: 'mock',
      model: 'same',
      system: 'byte-identical system',
      tools: snapshot.tools,
      temperature: 0.2,
    })
  })

  it('surfaces a tool attempt instead of executing it', async () => {
    async function* toolChunks(): AsyncGenerator<StreamChunk> {
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: CallId('call-1'), name: 'read_file', arguments: '{}' },
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
    const llm = {
      prepareCall: async (config: BtwContextSnapshot['config']) => ({
        config,
        stream: () => toolChunks(),
      }),
    } as unknown as LlmRuntime
    const snapshot: BtwContextSnapshot = {
      parentSessionId: 'parent',
      config: { provider: 'mock', model: 'same' },
      sharedMessages: [],
      messages: [],
    }
    const result = await runBtwOneShot(llm, snapshot, 'sidechain', new AbortController().signal)
    expect(result.response).toContain('tried to call read_file')
  })
})
