import { type ConnectionFetchRoute, type ConnectionRpcHandlerResult } from '@deepseek-ai/dsh-client-connection';
/** The exact Fetch route owns no Peer scope; peer-bound work belongs to the host handler. */
export type BtwRpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ConnectionRpcHandlerResult>;
/** Add one plugin-owned endpoint to the authenticated shared carrier. */
export declare function createBtwRpcRoute(handler: BtwRpcHandler): ConnectionFetchRoute;
