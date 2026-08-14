import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import type z from '@deepseek-ai/schemastery'
import schema from '@deepseek-ai/schemastery'
import { BTW_ASK_ENDPOINT, BTW_RPC_CHANNEL, readAskRequest, type BtwAskResponse } from '../shared/protocol.js'
import { snapshotContext } from './context-snapshot.js'
import { runBtwOneShot } from './one-shot.js'
import { PrivateSidechainKernel, type SidechainConfig } from './sidechain-kernel.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: HostConnectionHandle
  }
}

export interface BtwConfig {
  readonly timeoutMs?: number
  readonly sidechain?: SidechainConfig
}

const sidechainSchema = schema.object({
  mode: schema.union(['private-jsonl', 'memory', 'none']).default('private-jsonl'),
  root: schema.string(),
  retentionDays: schema.natural().min(1).default(7),
  maxSessions: schema.natural().min(1).default(500),
})

export const Config: z<BtwConfig> = schema.object({
  timeoutMs: schema.natural().min(1).default(120_000),
  sidechain: sidechainSchema,
})

function internal(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function cancelled(message = 'The side question was cancelled.'): RpcResult<never> {
  return { ok: false, error: { code: 'cancelled', message, details: {} } }
}

function warnTranscriptFailure(ctx: Context, phase: 'open' | 'close', error: unknown): void {
  ctx.logger.warn(`dsh-btw: failed to ${phase} private sidechain transcript; the side answer is unaffected`)
  ctx.logger.warn(error)
}

export function installBtwService(ctx: Context, config: BtwConfig = {}): void {
  const timeoutMs = config.timeoutMs ?? 120_000
  const sidechains = new PrivateSidechainKernel(config.sidechain)
  const connection = ctx.get('connection')
  if (connection === undefined) throw new Error('dsh-btw requires the Host client-connection service')

  ctx.effect(() => connection.rpc.handle(
    BTW_RPC_CHANNEL,
    async (endpoint, payload, transportSignal): Promise<RpcResult<unknown>> => {
      if (endpoint !== BTW_ASK_ENDPOINT) {
        return { ok: false, error: { code: 'bad-request', message: `Unknown BTW endpoint: ${endpoint}`, details: { issues: [] } } }
      }
      const request = readAskRequest(payload)
      if (request === undefined) {
        return { ok: false, error: { code: 'bad-request', message: 'Invalid /btw request.', details: { issues: [] } } }
      }
      const agent = ctx.agents.get(SessionId(request.sessionId))
      if (agent === undefined) {
        return {
          ok: false,
          error: {
            code: 'session-not-found',
            message: `No live agent owns session "${request.sessionId}".`,
            details: { sessionId: SessionId(request.sessionId) },
          },
        }
      }

      const timeout = AbortSignal.timeout(timeoutMs)
      const signal = AbortSignal.any([transportSignal, timeout])
      let sidechainId: string | undefined
      let transcriptStarted = false
      try {
        signal.throwIfAborted()
        const snapshot = snapshotContext(agent, request.question)
        sidechainId = sidechains.createId()
        try {
          await sidechains.begin(request.question, snapshot, sidechainId)
          transcriptStarted = true
        } catch (writeError) {
          warnTranscriptFailure(ctx, 'open', writeError)
        }
        const result = await ctx.agents.withInitiator(agent, () =>
          runBtwOneShot(ctx.llm, snapshot, sidechainId as string, signal))
        if (transcriptStarted) {
          try {
            await sidechains.finish(sidechainId, { kind: 'success', result })
          } catch (writeError) {
            warnTranscriptFailure(ctx, 'close', writeError)
          }
        }
        const value: BtwAskResponse = {
          requestId: request.requestId,
          sidechainId,
          response: result.response,
          cacheStrategy: result.cacheStrategy,
          ...(result.usage === undefined ? {} : { usage: result.usage }),
        }
        return { ok: true, value }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        if (sidechainId !== undefined && transcriptStarted) {
          try {
            await sidechains.finish(sidechainId, { kind: 'error', message })
          } catch (writeError) {
            warnTranscriptFailure(ctx, 'close', writeError)
          }
        }
        if (transportSignal.aborted) return cancelled()
        if (timeout.aborted) return internal(`The side question timed out after ${timeoutMs} ms.`)
        return internal(message)
      }
    },
    { authority: 'trusted-host' },
  ))
}
