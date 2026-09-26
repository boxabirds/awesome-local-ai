import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { CameraContext } from '../canvas/CameraContext';
import { useCamera } from '../canvas/useCamera';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld, worldToScreen, type Point } from '../canvas/camera';
import { registerBoardTestHooks, registerUndoTestHooks } from '../canvas/testHooks';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useBoardKeys } from './useBoardKeys';
import { useMarquee } from './Marquee';
import { MarqueeRect } from './Marquee';
import { useTransformGesture } from './useTransformGesture';
import { useActiveTool } from '../tools/useActiveTool';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool, penCursor } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import { registerShapeType, registerConnectorType, registerStrokeType } from '../objects/registry';
import { createUndo } from './undo';
import { useUndo } from './useUndo';
import { SelectionOverlay } from './SelectionOverlay';
import { SelectionBar } from './SelectionBar';
import { Toolbar } from './Toolbar';
import { getObjectType, type ObjectProps } from '../objects/registry';
import { createCanvasMeasurer } from '../objects/textLayout';
import { deleteIfEmpty } from '@/shared/objects/text';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { SharePanel } from '../share/SharePanel';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  stickyNotes,
  type ObjectSnapshot,
} from '@/shared/board-model';
import { unionRects } from '@/shared/geometry';
import { createText } from '@/shared/objects/text';

// Story 10: the shape and connector types render through the registry.
// Registered at module load (idempotent), NOT in the registry module itself:
// registry unit tests must see 'shape'/'connector' as unknown in builds that
// never import the Board (forward compatibility, TC-12).
registerShapeType();
registerConnectorType();
// Story 11: freehand strokes (stroke.render / pen.select).
registerStrokeType();

/**
 * Story 4: the board is editable in every connection state except
 * `load_failed` — a board that could not be loaded must not accept edits
 * (they would be lost against the unreadable storage, and the UI says the
 * board is retrying, not editable). While connecting/reconnecting the
 * existing story-3 behaviour holds: edits apply locally and sync later.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * The full board UI for one existing board id (stories 1-7, plus the story 5
 * Share panel top-right). Extracted from App so the router can render it
 * only after the board's existence has been confirmed.
 *
 * Story 7: every object renders through the type registry
 * (`getObjectType`); selection, group move, bounding-box resize and group
 * delete are driven by the shared `useTransformGesture` + `useBoardKeys` so
 * all object types behave identically (sel.all_types).
 */
export function Board({ id }: { id: string }) {
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });

  const updateViewport = useCallback(() => {
    setViewport({ width: window.innerWidth, height: window.innerHeight });
  }, []);

  useEffect(() => {
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, [updateViewport]);

  const cameraState = useCamera(viewport);
  const { doc, objects, connectionState } = useBoardDoc(id);
  const selection = useSelection(objects);

  // Story 4: all edit handlers are no-ops while the board failed to load.
  const editable = canEdit(connectionState);

  // Story 8: per-user undo history. One controller per board doc; destroyed
  // on board change/unmount (the history is session-only). Created here (not
  // in App) because the Y.Doc is owned by useBoardDoc inside this component.
  const undo = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);
  const undoState = useUndo(undo, editable);
  const onBoundary = useCallback(() => undo.boundary(), [undo]);

  // Story 9/10: the active tool (per-client, never persisted). Reverts to
  // Select when the board stops being editable (text.not_editable). A
  // creation tool that produces an object selects it and returns to Select.
  const tools = useActiveTool({
    canEdit: editable,
    onSelectCreated: (id) => {
      // The new object is not in the snapshot yet: queue the select (the
      // click would be a no-op) so it lands once the snapshot catches up.
      selection.clear();
      selection.selectNew(id);
    },
  });
  // Story 9: width measurer for text boxes (canvas in the browser, estimate
  // fallback in non-browser envs). One per board is cheap (lazy canvas ctx).
  const measurer = useMemo(() => createCanvasMeasurer(), []);

  // Story 11: pen options (session state) + the press handler the Pen tool
  // registers. The ref indirection keeps the viewport/object callbacks stable
  // (they must not re-render on every pen state change).
  const pen = usePenOptions();
  const penDownRef = useRef<((e: ReactPointerEvent) => void) | null>(null);
  const handlePenDownReady = useCallback((h: (e: ReactPointerEvent) => void) => {
    penDownRef.current = h;
  }, []);
  const handlePenDown = useCallback((e: ReactPointerEvent) => {
    const h = penDownRef.current;
    if (h) h(e);
  }, []);
  // Story 9: stable per-tab creator id (string 6 identity is out of this
  // milestone; the tab id is the stand-in for `createdBy`).
  const clientId = useMemo(() => crypto.randomUUID(), []);

  // Test-only: expose the board snapshot/doc/selection (story 2/7 tests).
  // Layout effect (not passive): test readiness is keyed off the committed
  // DOM, so the hooks must be registered by the time the board is visible —
  // otherwise a test could read the PREVIOUS board's stale closures.
  useLayoutEffect(() => {
    registerBoardTestHooks(
      () => stickyNotes(objects),
      () => doc,
      () => [...selection.ids],
      () => objects,
    );
  }, [doc, objects, selection.ids]);

  // Test-only: expose the local per-user undo controller (story 8 tests).
  useLayoutEffect(() => {
    registerUndoTestHooks(undo);
  }, [undo]);

  // Test-only: keep the live connection state readable (story 3 tests).
  useLayoutEffect(() => {
    if (window.__vidi6) window.__vidi6.connectionState = connectionState;
  }, [connectionState]);

  // Story 7: shift+drag marquee (adds fully-inside objects to the selection).
  const marquee = useMarquee(cameraState.camera, objects, (ids) => selection.setMany(ids, true));

  // Story 7: group move + bounding-box resize, one gesture at a time.
  // Story 9: the single-text e/w handle drag re-measures with the shared
  // measurer.
  const gesture = useTransformGesture({
    doc,
    camera: cameraState.camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    measure: measurer,
    // Story 8: one whole drag (all its rAF transactions) is one undo step.
    onGestureStart: onBoundary,
    onGestureEnd: onBoundary,
  });

  const createStickyAt = useCallback(
    (world: Point) => {
      if (!editable) return;
      onBoundary();
      const newId = createSticky(doc, world);
      onBoundary();
      if (newId) {
        selection.startEdit(newId);
      }
    },
    [doc, editable, selection, onBoundary],
  );

  const createStickyCenter = useCallback(() => {
    createStickyAt(
      screenToWorld(cameraState.camera, {
        x: viewport.width / 2,
        y: viewport.height / 2,
      }),
    );
  }, [cameraState.camera, createStickyAt, viewport.width, viewport.height]);

  // Story 7: keyboard commands (select all, escape, arrows, delete, enter).
  // Story 9: N creates a sticky at the view centre; the tool shortcuts
  // (V/T/S/L/Escape) live in useActiveTool (story 10, tools.keys).
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    marqueeActive: marquee.rect !== null,
    cancelMarquee: marquee.cancel,
    onBoundary,
    onUndo: undoState.undo,
    onRedo: undoState.redo,
    onCreateStickyCenter: createStickyCenter,
  });

  // Story 9: create a size M text object with its top-left at `world` (the
  // click point, text.anchor), start editing it, and return the tool to
  // Select (text.create).
  const createTextAt = useCallback(
    (world: Point) => {
      if (!editable) return;
      onBoundary();
      const newId = createText(doc, world, clientId);
      onBoundary();
      if (newId) {
        // A new text starts a fresh single selection (the old selection is
        // replaced, as a plain click would do) and is immediately edited.
        tools.toolCreated(newId); // clear + click + back to Select
        selection.startEdit(newId);
      }
    },
    [doc, editable, clientId, selection, onBoundary, tools],
  );

  // Story 9: the viewport is fixed inset 0, so client coords are
  // viewport-local; used for both empty-space clicks and clicks on top of
  // existing objects (new text is created on top at that point).
  const createTextAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      createTextAt(screenToWorld(cameraState.camera, { x: clientX, y: clientY }));
    },
    [cameraState.camera, createTextAt],
  );

  // Story 7: delete the whole current selection (toolbar bin, Delete key and
  // the selection bar's "Delete selection" all go through this).
  const deleteSelection = useCallback(() => {
    if (!editable) return;
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    onBoundary();
    deleteObjects(doc, ids);
    onBoundary();
    selection.clear();
  }, [doc, editable, selection, onBoundary]);

  // Stable DOM order (creation order): reordering DOM nodes while a gesture
  // is in progress would move the node under the pointer and make the
  // browser implicitly release pointer capture. Visual stacking is done with
  // z-index instead (sel.transform).
  const stableObjects = useMemo(
    () => [...objects].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    [objects],
  );

  // Selection bar position: above the selection's bounding box (screen space).
  const barPos = useMemo(() => {
    if (selection.ids.size === 0) return null;
    const sel = objects.filter((o) => selection.ids.has(o.id));
    if (sel.length === 0) return null;
    const box = unionRects(sel.map((o) => objectBounds(o)));
    if (!box) return null;
    const tl = worldToScreen(cameraState.camera, { x: box.x, y: box.y });
    return { left: tl.x, top: Math.max(tl.y - 44, 4) };
  }, [selection.ids, objects, cameraState.camera]);

  const renderObjects = (): React.ReactNode =>
    stableObjects.map((o: ObjectSnapshot) => {
      const spec = getObjectType(o.type);
      // Unknown object types are skipped (forward compatibility, sel.registry).
      if (!spec) return null;
      const Comp = spec.Component;
      const props: ObjectProps = {
        ...o,
        selected: selection.ids.has(o.id),
        dragging: gesture.draggingIds !== null && gesture.draggingIds.has(o.id),
        editable,
        doc,
        zoom: cameraState.camera.zoom,
        onObjectPointerDown: (e: ReactPointerEvent<Element>) => {
          // Story 9: with the Text tool active, a press anywhere (objects
          // included) creates a new text at the press point (text.create).
          if (tools.tool === 'text' && editable) {
            e.stopPropagation();
            createTextAtClientPoint(e.clientX, e.clientY);
            return;
          }
          // Story 11: with the Pen tool active, a press anywhere (objects
          // included) starts a stroke — it never moves or edits the object
          // below (pen.draw).
          if (tools.tool === 'pen' && editable) {
            e.stopPropagation();
            if (e.button === 0) handlePenDown(e);
            return;
          }
          gesture.onObjectPointerDown(e, o.id);
        },
      };
      if (o.type === 'sticky') {
        const note = stickyNotes([o])[0];
        props.note = note;
        props.editing = selection.editingId === o.id;
        props.onStartEdit = (noteId: string) => selection.startEdit(noteId);
        props.onEndEdit = (next: 'selected' | 'unselected') => {
          selection.endEdit();
          if (next === 'unselected') selection.clear();
        };
        // Story 8: in-editor undo/redo and capture window.
        props.onTextBoundary = onBoundary;
        props.onTextUndo = undoState.undo;
        props.onTextRedo = undoState.redo;
      }
      if (o.type === 'text') {
        // Story 9: text object props (design "Text rendering"). `doc`, the
        // box fields and `size`/`widthMode` arrive via the `...o` spread.
        props.note = o;
        props.editing = selection.editingId === o.id;
        props.onStartEdit = (textId: string) => selection.startEdit(textId);
        props.onEndEdit = (next: 'selected' | 'unselected') => {
          // Empty text vanishes on exit (one undo brings it back,
          // text.empty_delete). The editor already closed the capture window
          // before calling onEnd, so the deletion is its own undo step.
          if (deleteIfEmpty(doc, o.id)) {
            selection.clear();
          } else {
            selection.endEdit();
            if (next === 'unselected') selection.clear();
          }
        };
        // Story 8: in-editor undo/redo and capture window.
        props.onTextBoundary = onBoundary;
        props.onTextUndo = undoState.undo;
        props.onTextRedo = undoState.redo;
      }
      if (o.type === 'shape') {
        // Story 10: shape object props (shape.render / shape.label_limit).
        // `kind`/`fill`/`stroke`/`label` arrive via the `...o` spread.
        props.editing = selection.editingId === o.id;
        props.onStartEdit = (shapeId: string) => selection.startEdit(shapeId);
        props.onEndEdit = (next: 'selected' | 'unselected') => {
          selection.endEdit();
          if (next === 'unselected') selection.clear();
        };
        // Story 8: in-editor undo/redo and capture window.
        props.onTextBoundary = onBoundary;
        props.onTextUndo = undoState.undo;
        props.onTextRedo = undoState.redo;
      }
      if (o.type === 'connector') {
        // Story 10: connector object props (conn.render / connector.handle).
        // `from`/`to`/`fromPoint`/`toPoint` arrive via the `...o` spread.
        props.objects = objects;
        props.onBoundary = onBoundary;
      }
      return <Comp key={o.id} {...props} />;
    });

  return (
    <CameraContext.Provider value={cameraState}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        onCreateStickyAt={editable ? createStickyAt : undefined}
        onCreateTextAt={createTextAt}
        tool={tools.tool}
        onPenDown={tools.tool === 'pen' && editable ? handlePenDown : undefined}
        penCursor={tools.tool === 'pen' ? penCursor(pen.thickness, cameraState.camera.zoom) : undefined}
        onClearSelection={() => selection.clear()}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        {renderObjects()}
      </BoardViewport>
      {/* Story 10: creation tool overlays (above the viewport; they capture
          all pointer events while active, so the board neither pans nor
          selects underneath). */}
      {tools.tool === 'shape' && editable && (
        <ShapeTool
          kind={tools.shapeKind}
          camera={cameraState.camera}
          doc={doc}
          createdBy={clientId}
          onBoundary={onBoundary}
          onCreated={(id: string) => tools.toolCreated(id)}
        />
      )}
      {tools.tool === 'connector' && editable && (
        <ConnectorTool
          camera={cameraState.camera}
          doc={doc}
          snapshot={objects}
          createdBy={clientId}
          onBoundary={onBoundary}
          onCreated={(id: string) => tools.toolCreated(id)}
        />
      )}
      {/* Story 11: the pen stays active across strokes (pen.active); it has
          no full-screen overlay — the board stays fully live under it (pan,
          zoom, other tools' objects). */}
      {tools.tool === 'pen' && editable && (
        <PenTool
          camera={cameraState.camera}
          color={pen.color}
          thickness={pen.thickness}
          doc={doc}
          identityId={clientId}
          onBoundary={onBoundary}
          onDownReady={handlePenDownReady}
        />
      )}
      {tools.tool === 'pen' && editable && (
        <PenToolbar
          color={pen.color}
          thickness={pen.thickness}
          onColor={pen.setColor}
          onThickness={pen.setThickness}
        />
      )}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={cameraState.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      {barPos !== null && (
        <div style={{ position: 'fixed', left: barPos.left, top: barPos.top, zIndex: 10001 }}>
          <SelectionBar
            ids={selection.ids}
            snapshot={objects}
            doc={doc}
            editable={editable}
            editingId={selection.editingId}
            draggingIds={gesture.draggingIds}
            onDelete={deleteSelection}
            onBoundary={onBoundary}
            measure={measurer}
          />
        </div>
      )}
      <MarqueeRect rect={marquee.rect} camera={cameraState.camera} />
      <Toolbar
        onCreateSticky={createStickyCenter}
        disabled={!editable}
        canUndo={undoState.canUndo}
        canRedo={undoState.canRedo}
        onUndo={undoState.undo}
        onRedo={undoState.redo}
        tool={tools.tool}
        onSetTool={tools.setTool}
        shapeKind={tools.shapeKind}
        onSetShapeKind={tools.setShapeKind}
      />
      <ZoomControls
        zoomPercent={zoomPercent(cameraState.camera)}
        canZoomIn={canZoomIn(cameraState.camera)}
        canZoomOut={canZoomOut(cameraState.camera)}
        onZoomIn={() => cameraState.zoomStep('in')}
        onZoomOut={() => cameraState.zoomStep('out')}
        onReset={cameraState.reset}
      />
      <NavigationHint visible={!cameraState.hasNavigated} />
      {/* Story 5: share the board with a link (top-right). */}
      <SharePanel boardId={id} />
    </CameraContext.Provider>
  );
}
