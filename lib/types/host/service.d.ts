import type { Context } from '@deepseek-ai/cordis';
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import type z from '@deepseek-ai/schemastery';
import { type SidechainConfig } from './sidechain-kernel.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        connection: HostConnectionHandle;
    }
}
export interface BtwConfig {
    readonly timeoutMs?: number;
    readonly sidechain?: SidechainConfig;
}
export declare const Config: z<BtwConfig>;
export declare function installBtwService(ctx: Context, config?: BtwConfig): void;
