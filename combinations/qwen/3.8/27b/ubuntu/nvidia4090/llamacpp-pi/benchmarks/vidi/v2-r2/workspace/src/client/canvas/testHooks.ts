import type { Camera } from './camera';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';

declare global {
  interface Window {
    /** Test-only board control (e2e); absent in production builds. */
    __vidi6?: {
      setCamera(cam: Camera): void;
      /** Read one object's current model state, or undefined when absent. */
      getObject(id: string): BoardObjectState | undefined;
      /** Every object's current model state, sorted by id (story 3). */
      getObjects(): BoardObjectState[];
      /** Live mapped ConnectionState of the board provider (story 3). */
      connectionState: string;
      /**
       * Drops the live WebSocket (simulates the network going away) so the
       * provider's disconnect path runs. Used by the e2e outage test (TC-27).
       */
      dropConnection(): void;
      /** Brings the WebSocket back (simulates the network returning). */
      resumeConnection(): void;
    };
  }
}

export interface BoardObjectState {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
  /** Present for objects with a stored size (story 7 resize). */
  width?: number;
  height?: number;
  /** Free text (story 9): the size preset and width mode. */
  size?: string;
  widthMode?: 'auto' | 'fixed';
  /** Shape (story 10): the kind and named colours; the label also shows
   *  up in `text`. */
  kind?: string;
  fill?: string;
  stroke?: string;
  label?: string;
  /** Connector (story 10): the endpoint descriptors and their resolved
   *  points; `x/y/width/height` are the derived bounding box. */
  from?: { kind: string; objectId?: string; x?: number; y?: number };
  to?: { kind: string; objectId?: string; x?: number; y?: number };
  fromPoint?: { x: number; y: number };
  toPoint?: { x: number; y: number };
  /** The object's type name ('sticky', 'text', 'shape', 'connector',
   *  'stroke'). */
  type?: string;
  /** Stroke (story 11): the flattened path relative to the bbox origin,
   *  the creation-time base size, and the thickness name. */
  points?: number[];
  baseWidth?: number;
  baseHeight?: number;
  thickness?: string;
}

/**
 * Installs the `window.__vidi6` test hooks, but only in test builds
 * (`vite build --mode test` / Vitest). In production builds the condition is
 * statically false, so the hooks are excluded from the bundle.
 *
 * `connectionState` starts at 'connecting'; App keeps it current via
 * `updateVidi6ConnectionState` on every transition.
 */
export function installVidi6TestHooks(
  setCamera: (cam: Camera) => void,
  getObjects: () => readonly ObjectSnapshot[],
  dropConnection: () => void,
  resumeConnection: () => void,
): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') {
    return;
  }
  window.__vidi6 = {
    setCamera,
    getObject: (id) => {
      const o = getObjects().find((o) => o.id === id);
      return o === undefined ? undefined : toState(o);
    },
    getObjects: (): BoardObjectState[] =>
      getObjects()
        .map(toState)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    connectionState: 'connecting',
    dropConnection,
    resumeConnection,
  };
}

/** Updates the hook's live connectionState (no-op outside test builds). */
export function updateVidi6ConnectionState(state: string): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') {
    return;
  }
  if (window.__vidi6 !== undefined) {
    window.__vidi6.connectionState = state;
  }
}

function toState(o: ObjectSnapshot): BoardObjectState {
  const s = o as StickySnapshot;
  return {
    id: o.id,
    x: o.x,
    y: o.y,
    z: o.z,
    color: typeof s.color === 'string' ? s.color : '',
    text: typeof s.text === 'string' ? s.text : '',
    width: o.width,
    height: o.height,
    size: o.size,
    widthMode: o.widthMode,
    kind: o.kind,
    fill: o.fill,
    stroke: o.stroke,
    label: o.label,
    from: o.from === undefined ? undefined : endpointState(o.from),
    to: o.to === undefined ? undefined : endpointState(o.to),
    fromPoint: o.fromPoint,
    toPoint: o.toPoint,
    type: o.type,
    points: o.points === undefined ? undefined : [...o.points],
    baseWidth: o.baseWidth,
    baseHeight: o.baseHeight,
    thickness: o.thickness,
  };
}

/** One connector endpoint for the test hook (story 10). */
function endpointState(e: { kind: string; objectId?: string; x?: number; y?: number }) {
  return { kind: e.kind, objectId: e.objectId, x: e.x, y: e.y };
}
