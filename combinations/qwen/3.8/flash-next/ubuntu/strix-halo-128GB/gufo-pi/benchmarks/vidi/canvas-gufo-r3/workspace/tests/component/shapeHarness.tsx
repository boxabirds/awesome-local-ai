import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { render, act, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { Camera } from '@client/canvas/camera';
import { initDoc, snapshotAll, objectBounds, type ObjectSnapshot } from '@shared/board-model';
import { createShape } from '@shared/objects/shape';
import { createConnector, type Endpoint } from '@shared/objects/connector';
import { useSelection } from '@client/board/useSelection';
import { useActiveTool, type ToolId } from '@client/tools/useActiveTool';
import { Toolbar } from '@client/board/Toolbar';
import { ShapeObject } from '@client/objects/ShapeObject';
import { ConnectorObject } from '@client/objects/ConnectorObject';
import { ShapeTool } from '@client/tools/ShapeTool';
import { ConnectorTool } from '@client/tools/ConnectorTool';
import type { Rect } from '@shared/geometry';

export const VIEWPORT = { width: 1280, height: 800 };

export interface ShapeHarnessApi {
  doc: Y.Doc;
  tool: ToolId;
  shapeKind: ReturnType<typeof useActiveTool>['shapeKind'];
  setTool(t: ToolId): void;
  setShapeKind(k: ReturnType<typeof useActiveTool>['shapeKind']): void;
  selection: ReturnType<typeof useSelection>;
  camera: Camera;
  snapshot(): readonly ObjectSnapshot[];
  objectsRects(): Map<string, Rect>;
}

interface CompProps {
  apiRef: React.MutableRefObject<ShapeHarnessApi | null>;
  canEdit?: boolean;
  onToolChangeSpy?: (t: ToolId) => void;
}

function HarnessComp({ apiRef, canEdit = true }: CompProps) {
  const doc = useRef(new Y.Doc()).current;
  useEffect(() => {
    initDoc(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [snap, setSnap] = useState<readonly ObjectSnapshot[]>(() => snapshotAll(doc));
  useEffect(() => {
    const handler = () => setSnap(snapshotAll(doc));
    doc.on('update', handler);
    return () => doc.off('update', handler);
  }, [doc]);

  const [camera, setCameraState] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const selection = useSelection(snap);
  const selectCreated = useCallback((id: string) => selection.click(id), [selection]);
  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool({
    canEdit,
    onSelect: selectCreated,
  });

  const objectRects = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const o of snap) {
      if (o.type === 'connector') continue;
      m.set(o.id, objectBounds(o));
    }
    return m;
  }, [snap]);

  apiRef.current = {
    doc,
    tool,
    shapeKind,
    setTool,
    setShapeKind,
    selection,
    camera,
    snapshot: () => snapshotAll(doc),
    objectsRects: () => {
      const m = new Map<string, Rect>();
      for (const o of snapshotAll(doc)) {
        if (o.type !== 'connector') m.set(o.id, objectBounds(o));
      }
      return m;
    },
  };
  // keep setCamera reachable for zoom tests
  (apiRef.current as unknown as { setCamera: (c: Camera) => void }).setCamera = setCameraState;

  const overlay =
    tool === 'shape' ? (
      <ShapeTool kind={shapeKind} camera={camera} doc={doc} onCreated={toolCreated} />
    ) : tool === 'connector' ? (
      <ConnectorTool camera={camera} doc={doc} snapshot={snap} onCreated={toolCreated} />
    ) : null;

  return (
    <div style={{ width: VIEWPORT.width, height: VIEWPORT.height, position: 'relative' }}>
      <div data-testid="world" style={{ position: 'absolute', inset: 0 }}>
        {snap.map((o) => {
          if (o.type === 'shape') {
            return (
              <ShapeObject
                key={o.id}
                shape={o}
                doc={doc}
                zoom={camera.zoom}
                selected={selection.ids.has(o.id)}
                editing={o.id === selection.editingId}
                dragging={false}
                readOnly={!canEdit}
                onSelect={selection.click}
                onToggle={selection.toggle}
                onStartEdit={selection.startEdit}
                onEndEdit={selection.endEdit}
              />
            );
          }
          if (o.type === 'connector') {
            return (
              <ConnectorObject
                key={o.id}
                connector={o}
                doc={doc}
                zoom={camera.zoom}
                camera={camera}
                rects={objectRects}
                selected={selection.ids.has(o.id)}
                readOnly={!canEdit}
                onSelect={selection.click}
                onToggle={selection.toggle}
              />
            );
          }
          return null;
        })}
      </div>
      <Toolbar onCreateSticky={() => {}} disabled={!canEdit} tool={tool} onToolChange={setTool} shapeKind={shapeKind} onShapeKindChange={setShapeKind} />
      {overlay}
    </div>
  );
}

export function renderShapeHarness(canEdit = true) {
  const apiRef: React.MutableRefObject<ShapeHarnessApi | null> = { current: null };
  const utils = render(<HarnessComp apiRef={apiRef} canEdit={canEdit} />);
  const api = () => apiRef.current as ShapeHarnessApi & { setCamera(c: Camera): void };
  return { api, ...utils };
}

export function addShape(
  api: () => ShapeHarnessApi,
  kind: 'rect' | 'ellipse' | 'diamond',
  rect: { x: number; y: number; width: number; height: number },
): string {
  let id = '';
  act(() => {
    id = createShape(api().doc, { kind, rect, at: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } }, 'user')!;
  });
  return id;
}

export function addConnector(
  api: () => ShapeHarnessApi,
  from: Endpoint,
  to: Endpoint,
): string {
  let id = '';
  act(() => {
    id = createConnector(api().doc, from, to, 'user')!;
  });
  return id;
}

afterEach(cleanup);
