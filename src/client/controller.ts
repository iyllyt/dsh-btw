import { createSnapshotStore, type SessionId, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { BTW_ASK_ENDPOINT, BTW_RPC_CHANNEL, readAskResponse } from '../shared/protocol.js'

export type BtwOverlayState =
  | { readonly status: 'closed' }
  | { readonly status: 'running'; readonly question: string }
  | { readonly status: 'success'; readonly question: string; readonly response: string }
  | { readonly status: 'error'; readonly question: string; readonly error: string }

const CLOSED: BtwOverlayState = { status: 'closed' }
const CLIENT_RPC_TIMEOUT_MS = 125_000

function requestId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `btw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export class BtwController {
  readonly state: SnapshotStore<BtwOverlayState> = createSnapshotStore<BtwOverlayState>(CLOSED)
  private active: AbortController | undefined
  private disposed = false

  constructor(
    private readonly connection: ConnectionHandle,
    private readonly sessionId: SessionId,
    private readonly timeoutMs = CLIENT_RPC_TIMEOUT_MS,
  ) {}

  ask(rawQuestion: string): Promise<SubmitOutcome> {
    const question = rawQuestion.trim()
    if (question === '') return Promise.resolve({ kind: 'error', text: 'Usage: /btw <your question>' })
    this.active?.abort()
    const controller = new AbortController()
    this.active = controller
    this.state.set({ status: 'running', question })
    void this.run(question, controller)
    // Release the input machine immediately.  The overlay owns the background
    // request from here, so the main composer remains usable while BTW runs.
    return Promise.resolve({ kind: 'success' })
  }

  private async run(question: string, controller: AbortController): Promise<void> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = AbortSignal.any([controller.signal, timeout])
    try {
      const id = requestId()
      const result = await this.connection.rpc.call(BTW_RPC_CHANNEL, BTW_ASK_ENDPOINT, {
        requestId: id,
        sessionId: String(this.sessionId),
        question,
      }, signal)
      if (this.disposed || controller.signal.aborted || this.active !== controller) return
      if (!result.ok) {
        this.state.set({ status: 'error', question, error: result.error.message })
        return
      }
      const response = readAskResponse(result.value)
      if (response === undefined || response.requestId !== id) {
        this.state.set({ status: 'error', question, error: 'The BTW host returned an invalid response.' })
        return
      }
      this.state.set({ status: 'success', question, response: response.response })
    } catch (error: unknown) {
      if (this.disposed || controller.signal.aborted || this.active !== controller) return
      if (timeout.aborted) {
        this.state.set({ status: 'error', question, error: 'The BTW request timed out.' })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.state.set({ status: 'error', question, error: message })
    } finally {
      if (this.active === controller) this.active = undefined
    }
  }

  dismiss(): void {
    this.active?.abort()
    this.active = undefined
    this.state.set(CLOSED)
  }

  dispose(): void {
    this.disposed = true
    this.dismiss()
  }
}
