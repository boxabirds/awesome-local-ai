/** Page-side globals the e2e tests install (in addition to `window.__vidi6`). */

export interface WheelObservation {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

declare global {
  interface Window {
    __wheelObservations: WheelObservation[];
  }
}

export {};
