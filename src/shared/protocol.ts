export const BTW_RPC_CHANNEL = '/api'
export const BTW_ASK_ENDPOINT = 'dsh-btw/ask'

export interface BtwAskRequest {
  readonly requestId: string
  readonly sessionId: string
  readonly question: string
}

export type BtwCacheStrategy =
  | 'anthropic-shared-prefix'
  | 'provider-managed'

export interface BtwUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}

export interface BtwAskResponse {
  readonly requestId: string
  readonly sidechainId: string
  readonly response: string
  readonly cacheStrategy: BtwCacheStrategy
  readonly usage?: BtwUsage
}

export function readAskRequest(value: unknown): BtwAskRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (typeof source.requestId !== 'string' || source.requestId.length === 0 || source.requestId.length > 128) return undefined
  if (typeof source.sessionId !== 'string' || source.sessionId.length === 0 || source.sessionId.length > 256) return undefined
  if (typeof source.question !== 'string') return undefined
  const question = source.question.trim()
  if (question.length === 0 || question.length > 32_000) return undefined
  return { requestId: source.requestId, sessionId: source.sessionId, question }
}

export function readAskResponse(value: unknown): BtwAskResponse | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (typeof source.requestId !== 'string' || typeof source.sidechainId !== 'string' || typeof source.response !== 'string') {
    return undefined
  }
  if (source.cacheStrategy !== 'anthropic-shared-prefix' && source.cacheStrategy !== 'provider-managed') return undefined
  const usage = readUsage(source.usage)
  if (source.usage !== undefined && usage === undefined) return undefined
  return {
    requestId: source.requestId,
    sidechainId: source.sidechainId,
    response: source.response,
    cacheStrategy: source.cacheStrategy,
    ...(usage === undefined ? {} : { usage }),
  }
}

function readUsage(value: unknown): BtwUsage | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (!isCount(source.inputTokens) || !isCount(source.outputTokens)) return undefined
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    if (source[key] !== undefined && !isCount(source[key])) return undefined
  }
  return source as unknown as BtwUsage
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
