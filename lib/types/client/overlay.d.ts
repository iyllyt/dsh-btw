import type { BtwController } from './controller.js';
export interface BtwOverlayInjected {
    readonly controller: BtwController;
}
export declare function BtwOverlay({ controller }: BtwOverlayInjected): import("react").JSX.Element | null;
