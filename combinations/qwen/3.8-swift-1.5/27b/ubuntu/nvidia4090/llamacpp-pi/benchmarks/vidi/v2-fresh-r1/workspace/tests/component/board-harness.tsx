// Shared board harness for component tests (story 7 architecture):
// viewport + marquee + registry-rendered objects + selection overlay +
// selection bar + transform gesture + board keyboard shortcuts.

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { BoardViewport, CameraContext } from '../../src/client/canvas/BoardViewport';
import { useCamera } from '../../src/client/canvas/useCamera';
import type { Size } from '../../src/client/canvas/camera';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useTool } from '../../src/client/board/useTool';
import { Toolbar } from '../../src/client/board/Toolbar';
import { createText, deleteIfEmpty, isEmptyText, setTextSize } from '../../src/shared/objects/text';
import { createShape, setShapeStyle } from '../../src/shared/objects/shape';
import { createConnector } from '../../src/shared/objects/connector';
import { useMarquee, MarqueeRect } from '../../src/client/board/Marquee';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../src/client/board/SelectionBar';
import { getObjectType } from '../../src/client/objects/registry';
import { ShapeTool } from '../../src/client/tools/ShapeTool';
import { ConnectorTool } from '../../src/client/tools/ConnectorTool';
import { PenTool } from '../../src/client/tools/PenTool';
import { PenToolbar } from '../../src/client/tools/PenToolbar';
import { usePenOptions } from '../../src/client/tools/usePenOptions';
import type { ShapeKind, FillColor, StrokeColor } from '../../src/shared/config';

/** Viewport size used by the harness (default laptop). */
export const HARNESS_SIZE: Size = { width: 1280, height: 800 };

/** Subscribe to a Y.Doc's objects map; returns the current snapshot. */
export function useDocSnapshot(
  doc: Y.Doc,
  snapshotOfDoc?: (doc: Y.Doc) => readonly ObjectSnapshot[],
): readonly ObjectSnapshot[] {
  const take = snapshotOfDoc ?? snapshot;
  const [snap, setSnap] = useState(() => take(doc));
  useEffect(() => {
    const objects = doc.getMap('objects');
    const handler = () => setSnap(take(doc));
    objects.observeDeep(handler);
    return () => objects.unobserveDeep(handler);
  }, [doc, take]);
  return snap;
}

export function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  return doc;
}

export function BoardHarness(props: {
  doc: Y.Doc;
  /** Set false to simulate a load-failed board (editing locked). */
  canEdit?: boolean;
  /** Test-only: snapshot override (e.g. to include fixture object types). */
  snapshotOfDoc?: (doc: Y.Doc) => readonly ObjectSnapshot[];
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  /** Render the toolbar (tool buttons) for tool-mode tests. */
  withToolbar?: boolean;
}) {
  const { doc, canEdit = true, snapshotOfDoc, onGestureStart, onGestureEnd, withToolbar = false } = props;
  const api = useCamera(HARNESS_SIZE);
  const objects = useDocSnapshot(doc, snapshotOfDoc);
  const selection = useSelection(objects);

  const gesture = useTransformGesture({
    doc,
    camera: api.camera,
    selection,
    snapshot: objects,
    canEdit,
    onGestureStart,
    onGestureEnd,
  });
  const marquee = useMarquee(api.camera, objects, (ids) => selection.setMany(ids, true));
  const { tool, shapeKind, setTool, setShapeKind, toolCreated, onToolCreated } = useTool(canEdit);
  const penOptions = usePenOptions();

  // Register selection callback for toolCreated (deferred to allow snapshot update)
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    onToolCreated((id: string) => {
      queueMicrotask(() => {
        selectionRef.current.setMany([id], false);
      });
    });
  }, [onToolCreated]);

  const handleCreateSticky = () => {
    if (!canEdit) return;
    const centre = { x: HARNESS_SIZE.width / 2, y: HARNESS_SIZE.height / 2 };
    const world = screenToWorld(api.camera, centre);
    onGestureStart?.();
    const id = createSticky(doc, world);
    onGestureEnd?.();
    if (id) selection.startEditFresh(id);
  };

  const handleCreateStickyRef = { current: handleCreateSticky };

  const handleCreateText = (pt: { x: number; y: number }) => {
    if (!canEdit) return;
    const world = screenToWorld(api.camera, pt);
    onGestureStart?.();
    const id = createText(doc, world, 'test');
    onGestureEnd?.();
    if (id) {
      setTool('select');
      selection.startEditFresh(id);
    }
  };

  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit,
    tool,
    setTool,
    onCreateSticky: () => handleCreateStickyRef.current(),
  });

  const handleDblClickEmpty = (pt: { x: number; y: number }) => {
    if (tool === 'text') return;
    const world = screenToWorld(api.camera, pt);
    const id = createSticky(doc, world);
    if (id) selection.startEdit(id);
  };

  const handleDeleteSelection = () => {
    if (selection.ids.size === 0) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  };

  const handleTextEditEnd = () => {
    const id = selection.editingId;
    if (id === null) return;
    if (isEmptyText(doc, id)) {
      deleteIfEmpty(doc, id);
      selection.clear();
    } else {
      selection.endEdit();
    }
  };

  const handleTextSize = (id: string, size: import('../../src/shared/config').TextSize) => {
    setTextSize(doc, id, size);
  };

  const handleShapeFill = (id: string, fill: FillColor) => {
    setShapeStyle(doc, id, { fill });
  };

  const handleShapeStroke = (id: string, stroke: StrokeColor) => {
    setShapeStyle(doc, id, { stroke });
  };

  const handleObjectDoubleClick = (id: string) => {
    const obj = objects.find((o) => o.id === id);
    if (obj && getObjectType(obj.type)?.editableText) selection.startEdit(id);
  };

  // Story 11: a stroke click that misses its line selects the object
  // underneath (topmost whose hit test passes), else clears the selection.
  const handleObjectMiss = (e: React.PointerEvent<Element>, missedId: string) => {
    const world = screenToWorld(api.camera, { x: e.clientX, y: e.clientY });
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (o.id === missedId) continue;
      const spec = getObjectType(o.type);
      if (spec && spec.hitTest(o, world, api.camera.zoom)) {
        selection.click(o.id);
        return;
      }
    }
    selection.clear();
  };

  return (
    <CameraContext.Provider value={api}>
      <div>
        <BoardViewport
          onDblClickEmpty={handleDblClickEmpty}
          onClickEmpty={() => selection.clear()}
          marquee={marquee}
          tool={tool}
          onTextCreate={handleCreateText}
        >
          {objects.map((obj) => {
            const spec = getObjectType(obj.type);
            if (!spec) return null;
            const Component = spec.Component;
            return (
              <Component
                key={obj.id}
                obj={obj}
                doc={doc}
                zoom={api.camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={selection.editingId === obj.id}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onObjectDoubleClick={handleObjectDoubleClick}
                onEndEdit={obj.type === 'text' ? handleTextEditEnd : selection.endEdit}
                onObjectMiss={handleObjectMiss}
              />
            );
          })}
          <MarqueeRect rect={marquee.rect} />
        </BoardViewport>
        {tool === 'shape' && canEdit && (
          <ShapeTool
            kind={shapeKind}
            camera={api.camera}
            doc={doc}
            onCreated={toolCreated}
          />
        )}
        {tool === 'connector' && canEdit && (
          <ConnectorTool
            camera={api.camera}
            snapshot={objects}
            doc={doc}
            onCreated={toolCreated}
          />
        )}
        {tool === 'pen' && canEdit && (
          <>
            <PenTool
              camera={api.camera}
              color={penOptions.color}
              thickness={penOptions.thickness}
              doc={doc}
              identityId="test"
            />
            <PenToolbar
              color={penOptions.color}
              thickness={penOptions.thickness}
              onColor={penOptions.setColor}
              onThickness={penOptions.setThickness}
            />
          </>
        )}
        <SelectionOverlay
          ids={selection.ids}
          snapshot={objects}
          camera={api.camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
        />
        <SelectionBar
          ids={selection.ids}
          snapshot={objects}
          camera={api.camera}
          onDelete={handleDeleteSelection}
          onStickyColor={(id, c: StickyColor) => setStickyColor(doc, id, c)}
          onTextSize={handleTextSize}
          onShapeFill={handleShapeFill}
          onShapeStroke={handleShapeStroke}
        />
        {withToolbar && (
          <Toolbar
            onCreateSticky={handleCreateSticky}
            disabled={!canEdit}
            tool={tool}
            onToolChange={setTool}
            shapeKind={shapeKind}
            onShapeKindChange={setShapeKind}
          />
        )}
        <div data-testid="tool" data-value={tool} />
        <div data-testid="selected" data-value={[...selection.ids].sort().join(',')} />
        <div data-testid="editing" data-value={selection.editingId ?? ''} />
        <div data-testid="note-count" data-value={String(objects.length)} />
        <div data-testid="camera-x" data-value={String(api.camera.x)} />
        <div data-testid="camera-y" data-value={String(api.camera.y)} />
      </div>
    </CameraContext.Provider>
  );
}
