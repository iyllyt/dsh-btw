import { type LlmRuntime, type TokenUsage } from '@deepseek-ai/dsh-llm';
import type { BtwCacheStrategy } from '../shared/protocol.js';
import type { BtwContextSnapshot } from './context-snapshot.js';
export interface BtwOneShotResult {
    readonly response: string;
    readonly usage?: TokenUsage;
    readonly cacheStrategy: BtwCacheStrategy;
    readonly finishKind: string;
}
export declare function runBtwOneShot(llm: LlmRuntime, snapshot: BtwContextSnapshot, sidechainId: string, signal: AbortSignal): Promise<BtwOneShotResult>;
