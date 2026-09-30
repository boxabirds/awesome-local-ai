import { useRef, useLayoutEffect, useState, useEffect, useCallback } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld, type Camera, type Point } from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { useBoardDoc } from './useBoardDoc';
import { useSelection } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { useMarquee, MarqueeRect } from './Marquee';
import { useBoardKeys } from './useBoardKeys';
import { SelectionOverlay } from './SelectionOverlay';
import { SelectionBar } from './SelectionBar';
import { Toolbar } from './Toolbar';
import { getObjectType } from '../objects/registry';
import { createSticky, deleteObjects, objectSnapshot, snapshot } from '../../shared/board-model';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { canEdit, type ConnectionState } from '../sync/connectBoard';
import { createUndo, type UndoController } from './undo';
import { useUndo } from './useUndo';
import type { StickyColor } from '../../shared/config';

declare global {
  interface Window {
    __vidi6?: {
      setCamera(cam: Camera): void;
      doc?: Y.Doc;
      snapshot?(): readonly import('../../shared/board-model').StickySnapshot[];
      objects?(): readonly import('../../shared/board-model').ObjectSnapshot[];
      connectionState?: ConnectionState;
      createSticky?(x: number, y: number, color?: StickyColor): string | false;
    };
  }
}

/**
 * The board UI (canvas, toolbar, objects). Rendered by BoardPage once the
 * board's existence has been confirmed (story 5).
 *
 * Story 7: objects are rendered through the type registry; selection is a
 * set of ids with a shared transform gesture (move/resize), marquee,
 * selection overlay/bar and board keyboard shortcuts.
 */
export function Board({ boardId }: { boardId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1280, height: 800 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setSize({ width, height });
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStepFn, reset, setCamera } =
    useCamera(size);
  const { doc, objects, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(objects);

  // Story 8: one undo controller per board doc; destroyed on board change/unmount.
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) {
    undoRef.current = createUndo(doc);
  }
  // Destroy and recreate when doc changes (board change).
  useEffect(() => {
    return () => {
      undoRef.current?.destroy();
      undoRef.current = null;
    };
  }, [doc]);
  const undoController = undoRef.current;

  const [isPanning, setIsPanning] = useState(false);

  const handlePointerDown = (p: { x: number; y: number }) => {
    setIsPanning(true);
    beginPan(p);
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    endPan();
  };

  const handlePointerCancel = () => {
    setIsPanning(false);
    endPan();
  };

  // Editing is disabled only while the board cannot be loaded (story 4):
  // changes made to an unloadable board could not be stored. A transient
  // disconnect ('reconnecting') keeps the board editable — unsaved changes
  // are re-sent on reconnect.
  const editable = canEdit(connectionState);

  // Story 8: undo/redo binding.
  const { canUndo, canRedo, undo, redo } = useUndo(undoController, editable);

  // Shared move/resize gesture for the selection.
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => undoController.boundary(),
    onGestureEnd: () => undoController.boundary(),
  });

  // Marquee: Shift + drag on empty space select-adds fully-contained objects.
  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));

  // Escape also cancels an in-flight marquee (selection unchanged).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') marquee.cancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [marquee]);

  // Keyboard: select-all, clear, nudge, delete, enter-to-edit, undo/redo.
  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable, undoController });

  // Create a sticky note centred on a viewport point; select and edit it.
  const createStickyAtScreenPoint = useCallback(
    (p: Point) => {
      if (!canEdit(connectionState)) return;
      const world = screenToWorld(camera, p);
      const id = createSticky(doc, world);
      if (id) {
        // The note is not in the snapshot yet — select+edit without the
        // presence check.
        selection.selectAndEdit(id);
      }
    },
    [camera, doc, selection, connectionState]
  );

  // Toolbar button: create at the centre of the visible board area.
  const createStickyAtCentre = useCallback(() => {
    createStickyAtScreenPoint({ x: size.width / 2, y: size.height / 2 });
  }, [createStickyAtScreenPoint, size]);

  const deleteSelection = useCallback(() => {
    if (!canEdit(connectionState) || selection.ids.size === 0) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, connectionState]);

  // Expose test hook for e2e / component tests
  useEffect(() => {
    window.__vidi6 = {
      setCamera,
      doc,
      snapshot: () => snapshot(doc),
      objects: () => objectSnapshot(doc),
      connectionState,
      createSticky: (x: number, y: number, color?: StickyColor) => createSticky(doc, { x, y }, color),
    };
    return () => {
      delete window.__vidi6;
    };
  }, [setCamera, doc, connectionState]);

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={camera}
        isPanning={isPanning}
        onPointerDown={handlePointerDown}
        onPointerMove={panMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={wheel}
        onKeyZoomIn={() => zoomStepFn('in')}
        onKeyZoomOut={() => zoomStepFn('out')}
        onKeyReset={reset}
        onEmptyClick={() => selection.clear()}
        onCreateSticky={createStickyAtScreenPoint}
        onMarqueeBegin={marquee.begin}
        onMarqueeMove={marquee.move}
        onMarqueeEnd={marquee.end}
        onMarqueeCancel={marquee.cancel}
      >
        <MarqueeRect rect={marquee.rect} />
        {[...objects]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((obj) => {
            const spec = getObjectType(obj.type);
            if (!spec) return null;
            const Component = spec.Component;
            return (
              <Component
                key={obj.id}
                obj={obj}
                doc={doc}
                z={obj.z}
                zoom={camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={selection.editingId === obj.id}
                editable={editable}
                onPointerDown={gesture.onObjectPointerDown}
                onStartEdit={selection.startEdit}
                onEndEdit={() => selection.endEdit()}
                boundary={() => undoController.boundary()}
                undoController={undoController}
              />
            );
          })}
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        doc={doc}
        onDelete={deleteSelection}
      />
      <Toolbar
        onCreateSticky={createStickyAtCentre}
        disabled={!editable}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStepFn('in')}
        onZoomOut={() => zoomStepFn('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
