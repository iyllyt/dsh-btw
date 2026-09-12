import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { BtwController } from '../src/client/controller.js'

vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: <T>(initial: T) => {
    let value = initial
    return {
      getSnapshot: () => value,
      subscribe: () => () => {},
      update: (mutator: (draft: T) => void) => mutator(value),
      set: (next: T) => { value = next },
    }
  },
}))

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('BtwController', () => {
  it('releases the composer before the background RPC completes', async () => {
    let complete: ((value: unknown) => void) | undefined
    let actualRequestId: string | undefined
    const connection = {
      rpc: {
        call: (_channel: string, _endpoint: string, payload: unknown) => {
          actualRequestId = (payload as { requestId: string }).requestId
          return new Promise(resolve => { complete = resolve })
        },
      },
    } as unknown as ConnectionHandle
    const controller = new BtwController(connection, 'session' as SessionId, 1_000)

    await expect(controller.ask('side question')).resolves.toEqual({ kind: 'success' })
    expect(controller.state.getSnapshot()).toEqual({ status: 'running', question: 'side question' })

    complete?.({
      ok: true,
      value: {
        requestId: actualRequestId,
        sidechainId: 'sidechain',
        response: 'answer',
        cacheStrategy: 'provider-managed',
      },
    })
    await flush()
    expect(controller.state.getSnapshot()).toEqual({
      status: 'success',
      question: 'side question',
      response: 'answer',
    })
  })

  it('aborts the background RPC when the overlay is dismissed', async () => {
    let capturedSignal: AbortSignal | undefined
    const connection = {
      rpc: {
        call: (_channel: string, _endpoint: string, _payload: unknown, signal: AbortSignal) => {
          capturedSignal = signal
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        },
      },
    } as unknown as ConnectionHandle
    const controller = new BtwController(connection, 'session' as SessionId, 1_000)

    await controller.ask('side question')
    controller.dismiss()
    await flush()

    expect(capturedSignal?.aborted).toBe(true)
    expect(controller.state.getSnapshot()).toEqual({ status: 'closed' })
  })
})
