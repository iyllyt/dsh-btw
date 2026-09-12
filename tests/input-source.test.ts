import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { createBtwInputSource } from '../src/client/input-source.js'
import type { BtwController } from '../src/client/controller.js'

describe('BTW input source', () => {
  it('claims an argued /btw line directly instead of sending it to the main agent', async () => {
    const ask = vi.fn(async () => ({ kind: 'success' as const }))
    const source = createBtwInputSource(() => ({ ask } as unknown as BtwController))
    const outcome = await source.matchEnter?.(
      { sessionId: 'session' as SessionId },
      '/btw current secret?',
      new AbortController().signal,
    )
    expect(outcome).toBeDefined()
    if (outcome === undefined || outcome === 'handled' || !('claim' in outcome)) throw new Error('expected claim')
    await outcome.claim.submit('current secret?', {} as never)
    expect(ask).toHaveBeenCalledWith('current secret?')
  })
})
