import { Camera } from './camera';
import type { ConnectionState } from '@client/sync/connectBoard';
import * as Yjs from 'yjs';
import { createShape } from '@shared/objects/shape';
import type { ShapeKind } from '@shared/config';
import { createConnector, type Endpoint } from '@shared/objects/connector';

type YDoc = InstanceType<typeof Yjs.Doc>;

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      getCamera?(): Camera | undefined;
      /** Latest mapped connection state (test builds only; used by nightly TC-29). */
      connectionState?: ConnectionState;
      /** Live board doc (test builds only). */
      doc?: unknown;
      boardId?: string | null;
      /** Seed a shape on the live doc (test builds only). Returns the new id or null. */
      testCreateShape?(kind: ShapeKind, rect: { x: number; y: number; width: number; height: number }, by?: string): string | null;
      /** Seed a connector on the live doc (test builds only). Returns the new id or null. */
      testCreateConnector?(from: Endpoint, to: Endpoint, by?: string): string | null;
    };
  }
}

export function setupTestHooks(
  setCamera: (cam: Camera) => void,
  getCamera?: () => Camera,
  getters?: { getDoc?: () => unknown; getBoardId?: () => string | null },
) {
  if (import.meta.env.MODE === 'test') {
    window.__vidi6 = {
      setCamera,
      getCamera,
      get doc() {
        return getters?.getDoc?.();
      },
      get boardId() {
        return getters?.getBoardId?.() ?? null;
      },
      testCreateShape(kind, rect, by = 'tester') {
        const doc = getters?.getDoc?.() as YDoc | undefined;
        if (!doc) return null;
        return createShape(doc, { kind, rect, at: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } }, by);
      },
      testCreateConnector(from, to, by = 'tester') {
        const doc = getters?.getDoc?.() as YDoc | undefined;
        if (!doc) return null;
        return createConnector(doc, from, to, by);
      },
    };
  }
}

/** Publish the current connection state to the test hooks (no-op outside test builds). */
export function setTestConnectionState(state: ConnectionState) {
  if (import.meta.env.MODE === 'test' && window.__vidi6) {
    window.__vidi6.connectionState = state;
  }
}
