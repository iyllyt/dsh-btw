export declare const BTW_RPC_CHANNEL = "/btw-rpc";
export declare const BTW_ASK_ENDPOINT = "ask";
export interface BtwAskRequest {
    readonly requestId: string;
    readonly sessionId: string;
    readonly question: string;
}
export type BtwCacheStrategy = 'anthropic-shared-prefix' | 'provider-managed';
export interface BtwUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
    readonly reasoningTokens?: number;
}
export interface BtwAskResponse {
    readonly requestId: string;
    readonly sidechainId: string;
    readonly response: string;
    readonly cacheStrategy: BtwCacheStrategy;
    readonly usage?: BtwUsage;
}
export declare function readAskRequest(value: unknown): BtwAskRequest | undefined;
export declare function readAskResponse(value: unknown): BtwAskResponse | undefined;
