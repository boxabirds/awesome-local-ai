// Registers the `window.__vidi6` test hooks. Only the `test` build
// (`npm run build:test`, i.e. MODE=test) installs anything on `window`; in the
// production build the guarded block is statically false and is removed by the
// bundler, so the hook is excluded from production builds.

import type { Camera } from './camera';
import type * as Y from 'yjs';
import { snapshotByCreation, type StickySnapshot } from '../../shared/board-model';
import { COLLAB_ENDPOINT } from '../sync/endpoint';
import type { ConnectionState } from '../sync/connectBoard';

export type CameraSetter = (camera: Camera) => void;

let setter: CameraSetter | null = null;

interface MutableApi {
  setCamera?(x: number, y: number, zoom: number): void;
  doc?: Y.Doc;
  snapshot?(): readonly StickySnapshot[];
  __serverMode?: boolean;
  __drop?(): void;
  __restore?(): void;
  __awarenessPresent?(): boolean;
  __reconnectCount?(): number;
  __stateLog?(): readonly string[];
  __destroy?(): void;
  connectionState?: string;
}

/** Merge into the single `window.__vidi6` object without clobbering other keys. */
function patch(next: MutableApi): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') return;
  window.__vidi6 = { ...(window.__vidi6 as MutableApi | undefined), ...next } as unknown as
    typeof window.__vidi6;
}

/** Called by `useCamera` on mount (and cleared on unmount). */
export function registerCameraSetter(next: CameraSetter | null): void {
  setter = next;
  patch({
    setCamera: (x: number, y: number, zoom: number) => {
      setter?.({ x, y, zoom });
    },
  });
}

/**
 * Expose the live board document so end-to-end tests can compare two browsers'
 * state by content. `snapshot` returns plain JSON a test can read back over the
 * Playwright boundary (a raw Y.Doc cannot be serialised across it).
 */
export function registerBoardDoc(doc: Y.Doc | null): void {
  if (doc === null) return;
  patch({
    doc,
    snapshot: () => snapshotByCreation(doc),
    __serverMode: COLLAB_ENDPOINT !== '',
  });
}

export interface ConnectionControl {
  drop(): void;
  restore(): void;
  awarenessPresent(): boolean;
  reconnectCount(): number;
  destroy(): void;
}

/**
 * The mapped `ConnectionState`, newest last, deduplicated. A page-level log
 * because the state is a plain JS value a MutationObserver cannot watch; every
 * change is recorded, so the idle test can assert it never left `connected`
 * between the instants a poll happens to sample.
 */
const stateLog: ConnectionState[] = [];

/** Record the current mapped connection state (called on every change). */
export function registerConnectionState(state: ConnectionState): void {
  if (stateLog[stateLog.length - 1] !== state) stateLog.push(state);
  patch({ connectionState: state });
}

/**
 * Expose deterministic socket drop/restore, an awareness-presence probe and a
 * reconnect counter so end-to-end tests can simulate a dropped link (the badge,
 * offline catch-up and nightly awareness-soak cases) without reaching into the
 * provider's internals.
 */
export function registerConnectionControl(ctrl: ConnectionControl | null): void {
  if (ctrl === null) return;
  patch({
    __drop: ctrl.drop,
    __restore: ctrl.restore,
    __awarenessPresent: ctrl.awarenessPresent,
    __reconnectCount: ctrl.reconnectCount,
    __stateLog: () => stateLog.slice(),
    __destroy: ctrl.destroy,
  });
}
