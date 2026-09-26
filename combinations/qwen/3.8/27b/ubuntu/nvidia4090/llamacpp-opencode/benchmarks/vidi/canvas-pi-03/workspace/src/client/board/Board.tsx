import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
import { createUndo } from './undo';
import { useUndo } from './useUndo';
import { SelectionOverlay } from './SelectionOverlay';
import { SelectionBar } from './SelectionBar';
import { Toolbar } from './Toolbar';
import { getObjectType, type ObjectProps } from '../objects/registry';
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

  // Test-only: expose the board snapshot/doc/selection (story 2/7 tests).
  // Layout effect (not passive): test readiness is keyed off the committed
  // DOM, so the hooks must be registered by the time the board is visible —
  // otherwise a test could read the PREVIOUS board's stale closures.
  useLayoutEffect(() => {
    registerBoardTestHooks(
      () => stickyNotes(objects),
      () => doc,
      () => [...selection.ids],
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
  const gesture = useTransformGesture({
    doc,
    camera: cameraState.camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    // Story 8: one whole drag (all its rAF transactions) is one undo step.
    onGestureStart: onBoundary,
    onGestureEnd: onBoundary,
  });

  // Story 7: keyboard commands (select all, escape, arrows, delete, enter).
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
        onObjectPointerDown: (e: ReactPointerEvent<HTMLElement>) =>
          gesture.onObjectPointerDown(e, o.id),
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
      return <Comp key={o.id} {...props} />;
    });

  return (
    <CameraContext.Provider value={cameraState}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        onCreateStickyAt={createStickyAt}
        onClearSelection={() => selection.clear()}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        {renderObjects()}
      </BoardViewport>
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
