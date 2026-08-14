import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { BtwController } from './controller.js';
export type BtwControllerFor = (sessionId: SessionId) => BtwController;
export declare function createBtwInputSource(controllerFor: BtwControllerFor): InputTriggerSource;
