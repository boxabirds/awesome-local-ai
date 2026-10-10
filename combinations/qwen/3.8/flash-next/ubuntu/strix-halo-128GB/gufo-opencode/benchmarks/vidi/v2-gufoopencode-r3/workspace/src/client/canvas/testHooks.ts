import type * as Y from 'yjs';
import { createSticky, getStickyText, snapshot, type StickySnapshot } from '../../shared/board-model';
import { collectTextSnapshots, type TextSnapshot } from '../../shared/objects/text';
import { collectImageSnapshots, type ImageSnap } from '../../shared/objects/image';
import { collectConnectorViews, createConnector, type ConnectorView, type Endpoint } from '../../shared/objects/connector';
import { collectShapeSnapshots, createShape, getShapeLabel, type ShapeSnap } from '../../shared/objects/shape';
import {
  collectStrokeSnapshots,
  scaledPoints,
  type StrokeSnap
} from '../../shared/objects/stroke';
import type { Point } from '../../shared/geometry';
import type { StickyColor } from '../../shared/config';
import type { SyncStatus } from '../sync/connectBoard';
import type { Camera } from './camera';

export interface StrokeView extends StrokeSnap {
  worldPoints: readonly Point[];
}

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      getNotes(): readonly StickySnapshot[];
      getTexts(): readonly TextSnapshot[];
      getShapes(): readonly ShapeSnap[];
      getConnectors(): readonly ConnectorView[];
      getStrokes(): readonly StrokeView[];
      getImages(): readonly ImageSnap[];
      createShapeAt(opts: {
        kind: 'rect' | 'ellipse' | 'diamond';
        x: number;
        y: number;
        width?: number;
        height?: number;
        square?: boolean;
        label?: string;
      }): string | null;
      createConnectorEnds(from: Endpoint, to: Endpoint): string | null;
      connectionState(): SyncStatus | 'offline';
      createNote(opts: { x: number; y: number; text?: string; color?: StickyColor }): string;
    };
  }
}

// Test-only hook so e2e tests can jump the camera far away without dragging
// a million pixels and read note world state. Tree-shaken out of production
// builds (MODE !== 'test').
export function installTestHooks(
  setCamera: (cam: Camera) => void,
  doc: Y.Doc,
  connection: { status(): SyncStatus } | null
): void {
  if (import.meta.env.MODE !== 'test') return;
  window.__vidi6 = {
    setCamera,
    getNotes: () => snapshot(doc),
    getTexts: () => collectTextSnapshots(doc),
    getShapes: () => collectShapeSnapshots(doc),
    getConnectors: () => collectConnectorViews(doc),
    getStrokes: () => collectStrokeSnapshots(doc).map((s) => ({ ...s, worldPoints: scaledPoints(s) })),
    getImages: () => collectImageSnapshots(doc),
    createShapeAt: ({ kind, x, y, width, height, square, label }) => {
      const rect =
        width !== undefined && height !== undefined
          ? { x, y, width, height }
          : null;
      const id = createShape(doc, { kind, rect, at: { x, y }, square }, 'g_test');
      if (id !== null && label !== undefined && label !== '') {
        getShapeLabel(doc, id)?.insert(0, label);
      }
      return id;
    },
    createConnectorEnds: (from, to) => createConnector(doc, from, to, 'g_test'),
    connectionState: () => (connection === null ? 'offline' : connection.status()),
    // Scripted bulk creation for persistence specs: goes through the exact
    // same board-model mutation path as UI actions (local origin → sync →
    // room), just without 25 rounds of toolbar choreography.
    createNote: ({ x, y, text, color }) => {
      const id = createSticky(doc, { x, y }, color ?? 'yellow');
      if (text !== undefined && text !== '') {
        const ytext = getStickyText(doc, id);
        if (ytext !== undefined) ytext.insert(0, text);
      }
      return id;
    }
  };
}
