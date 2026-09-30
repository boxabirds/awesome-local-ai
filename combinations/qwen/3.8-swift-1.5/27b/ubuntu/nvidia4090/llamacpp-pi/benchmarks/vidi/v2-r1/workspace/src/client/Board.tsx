import { useRef, useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { screenToWorld } from './canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut } from './canvas/camera';
import { setupTestHooks } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { Toolbar } from './board/Toolbar';
import { createUndo, type UndoController } from './board/undo';
import { useUndo } from './board/useUndo';
import { getObjectType } from './objects/registry';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import {
  createSticky, deleteObjects, setStickyColor,
} from '@shared/board-model';
import type { StickyColor } from '@shared/config';
import type { Point } from './canvas/camera';

/**
 * Story 7 board UI: multi-object selection, group move, bounding-box
 * resize, marquee, keyboard shortcuts and the selection bar.
 */
export function Board(props: { boardId: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  const boardId = props.boardId;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cam = useCamera(size);
  const { doc, objects, connectionState } = useBoardDoc(boardId);

  // Set up test hooks
  useEffect(() => {
    setupTestHooks(cam, doc);
  }, [cam, doc]);

  const editAllowed = canEdit(connectionState);

  // Story 8: create one undo controller per board doc.
  const undoCtrlRef = useRef<UndoController | null>(null);
  const undoDocRef = useRef<Y.Doc | null>(null);
  if (doc && undoDocRef.current !== doc) {
    undoCtrlRef.current?.destroy();
    undoCtrlRef.current = createUndo(doc);
    undoDocRef.current = doc;
  }
  const undoController = undoCtrlRef.current;

  // Destroy controller on unmount or board change.
  useEffect(() => {
    return () => {
      undoCtrlRef.current?.destroy();
      undoCtrlRef.current = null;
      undoDocRef.current = null;
    };
  }, [doc]);

  // Story 8: React binding for undo/redo state.
  const undoState = useUndo(undoController!, editAllowed);

  // Multi-object selection (story 7).
  const selection = useSelection(objects);

  // Transform gesture: group move + bounding-box resize.
  const gestureStartedRef = useRef(false);
  const gesture = useTransformGesture({
    doc,
    camera: cam.camera,
    selection,
    snapshot: objects,
    canEdit: editAllowed,
    onGestureStart: () => {
      gestureStartedRef.current = true;
      undoController?.boundary();
    },
    onGestureEnd: () => {
      gestureStartedRef.current = false;
      undoController?.boundary();
    },
  });

  // Marquee: Shift+drag over empty space adds fully-contained objects.
  const marquee = useMarquee(cam.camera, objects, useCallback(
    (ids: string[]) => selection.setMany(ids, true),
    [selection],
  ));

  // Board-level keyboard shortcuts.
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editAllowed,
    isBusy: () => gestureStartedRef.current,
    isMarqueeActive: () => marquee.rect !== null,
    onEscape: () => {
      marquee.cancel();
      selection.clear();
    },
    onUndo: () => undoController?.undo(),
    onRedo: () => undoController?.redo(),
    isEditing: () => selection.editingId !== null,
  });

  // Create a sticky note at a world point
  const createStickyAt = useCallback((worldPoint: Point) => {
    if (!canEdit(connectionState)) return;
    undoController?.boundary();
    const id = createSticky(doc, worldPoint);
    if (id) {
      selection.startEdit(id);
    }
  }, [doc, selection, connectionState, undoController]);

  // Handle double-click on empty board space
  const handleDoubleClickEmpty = useCallback((screenPoint: Point) => {
    if (!canEdit(connectionState)) return;
    const worldPoint = screenToWorld(cam.camera, screenPoint);
    createStickyAt(worldPoint);
  }, [cam.camera, createStickyAt, connectionState]);

  // Handle click on Sticky note toolbar button
  const handleCreateSticky = useCallback(() => {
    if (!canEdit(connectionState)) return;
    const centre: Point = { x: size.width / 2, y: size.height / 2 };
    const worldPoint = screenToWorld(cam.camera, centre);
    createStickyAt(worldPoint);
  }, [cam.camera, size, createStickyAt, connectionState, undoController]);

  // Handle clear selection (click on empty space)
  const handlePointerUpEmpty = useCallback(() => {
    selection.clear();
  }, [selection]);

  // Handle colour change from the single-note toolbar
  const handleColorChange = useCallback((color: StickyColor) => {
    if (selection.ids.size === 1 && editAllowed) {
      undoController?.boundary();
      const [id] = selection.ids;
      setStickyColor(doc, id, color);
      undoController?.boundary();
    }
  }, [doc, selection, editAllowed, undoController]);

  // Handle delete from the selection bar / single-note toolbar
  const handleDelete = useCallback(() => {
    if (selection.ids.size === 0 || !editAllowed) return;
    undoController?.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController?.boundary();
  }, [doc, selection, editAllowed, undoController]);

  // Object props for the registry components
  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => gesture.onObjectPointerDown(e, id),
    [gesture],
  );
  const onStartEdit = useCallback((id: string) => {
    if (editAllowed) selection.startEdit(id);
  }, [selection, editAllowed]);
  const onEndEdit = useCallback((next: 'selected' | 'unselected') => {
    selection.endEdit(next);
  }, [selection]);
  const onUndoBoundary = useCallback(() => undoController?.boundary(), [undoController]);
  const onUndo = useCallback(() => undoController?.undo(), [undoController]);
  const onRedo = useCallback(() => undoController?.redo(), [undoController]);

  return (
    <div ref={viewportRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomAtPointer={cam.zoomAtPointer}
        zoomStep={cam.zoomStep}
        reset={cam.reset}
        isPanning={cam.isPanning}
        onDoubleClickEmpty={handleDoubleClickEmpty}
        onPointerUpEmpty={handlePointerUpEmpty}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
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
              zoom={cam.camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              onObjectPointerDown={onObjectPointerDown}
              onStartEdit={onStartEdit}
              onEndEdit={onEndEdit}
              onUndoBoundary={onUndoBoundary}
              onUndo={onUndo}
              onRedo={onRedo}
            />
          );
        })}
        <MarqueeRect rect={marquee.rect} camera={cam.camera} />
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={cam.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 1002 }}>
        <SelectionBar
          ids={selection.ids}
          snapshot={objects}
          onDelete={handleDelete}
          onColor={handleColorChange}
        />
      </div>
      <Toolbar
        onCreateSticky={handleCreateSticky}
        disabled={!editAllowed}
        canUndo={undoState.canUndo}
        canRedo={undoState.canRedo}
        onUndo={undoState.undo}
        onRedo={undoState.redo}
      />
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </div>
  );
}
