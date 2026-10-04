/**
 * Board content: the stories 1–7 board UI with the Share panel.
 * Only mounted when the board exists (BoardPage state = ready).
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { type Size, canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point } from '../canvas/camera';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { ZoomControls } from '../canvas/ZoomControls';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useUndoController, useUndo } from '../board/useUndo';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { useBoardKeys } from '../board/useBoardKeys';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { setConnectionState } from '../canvas/testHooks';
import { createSticky, deleteObjects, setStickyColor } from '../../shared/board-model';
import { SharePanel } from '../share/SharePanel';
import type { StickyColor } from '../../shared/config';

export function BoardContent({ boardId }: { boardId: string }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const camera = useCamera(viewport);

  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const editable = connectionState !== 'load_failed';

  // Per-user undo history (story 8): session-only, LOCAL_ORIGIN changes only.
  const undoController = useUndoController(doc);
  const undo = useUndo(undoController, editable);

  // Expose connection state on the test hook
  useEffect(() => {
    setConnectionState(connectionState);
  }, [connectionState]);

  const selection = useSelection(notes);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setViewport((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    return undefined;
  }, []);

  const screenPointToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = rootRef.current?.getBoundingClientRect();
      const sx = clientX - (rect?.left ?? 0);
      const sy = clientY - (rect?.top ?? 0);
      return screenToWorld(camera.camera, { x: sx, y: sy });
    },
    [camera.camera],
  );

  const createStickyAt = useCallback(
    (worldPoint: Point) => {
      if (!editable) return;
      undo.boundary();
      const id = createSticky(doc, worldPoint);
      if (id) {
        selection.startEdit(id);
      }
    },
    [doc, selection, editable, undo],
  );

  const handleDblClickEmpty = useCallback(
    (clientX: number, clientY: number) => {
      const world = screenPointToWorld(clientX, clientY);
      createStickyAt(world);
    },
    [screenPointToWorld, createStickyAt],
  );

  const handleClickEmpty = useCallback(() => {
    selection.clear();
  }, [selection]);

  const handleCreateSticky = useCallback(() => {
    const centre: Point = { x: viewport.width / 2, y: viewport.height / 2 };
    const world = screenToWorld(camera.camera, centre);
    createStickyAt(world);
  }, [viewport, camera.camera, createStickyAt]);

  // Transform gesture (each drag/resize is one undo step — story 8)
  const gesture = useTransformGesture({
    doc,
    camera: camera.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: undo.boundary,
    onGestureEnd: undo.boundary,
  });

  // Marquee
  const marquee = useMarquee(camera.camera, notes, (ids) => {
    selection.setMany(ids, true);
  });

  // Keyboard
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    onUndo: undo.undo,
    onRedo: undo.redo,
    onBoundary: undo.boundary,
  });

  // Handle for double-click on a note (start editing)
  const handleNoteDoubleClick = useCallback(
    (_e: React.MouseEvent, id: string) => {
      if (editable) {
        selection.startEdit(id);
      }
    },
    [selection, editable],
  );

  // Selection bar delete (its own undo step — story 8)
  const handleSelectionDelete = useCallback(() => {
    undo.boundary();
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, undo]);

  // Selection bar color change (its own undo step — story 8)
  const handleColorChange = useCallback(
    (id: string, color: StickyColor) => {
      undo.boundary();
      setStickyColor(doc, id, color);
    },
    [doc, undo],
  );

  // Marquee handlers for the viewport
  const handleMarqueeBegin = useCallback(
    (screenPoint: Point) => {
      marquee.begin(screenPoint);
    },
    [marquee],
  );

  const handleMarqueeMove = useCallback(
    (screenPoint: Point) => {
      marquee.move(screenPoint);
    },
    [marquee],
  );

  const handleMarqueeEnd = useCallback(() => {
    marquee.end();
  }, [marquee]);

  const handleMarqueeCancel = useCallback(() => {
    marquee.cancel();
  }, [marquee]);

  return (
    <div className="app-root" ref={rootRef}>
      <BoardViewport
        camera={camera.camera}
        hasNavigated={camera.hasNavigated}
        beginPan={camera.beginPan}
        panMove={camera.panMove}
        endPan={camera.endPan}
        wheel={camera.wheel}
        zoomStep={camera.zoomStep}
        reset={camera.reset}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
        onShiftPointerDownEmpty={handleMarqueeBegin}
        onShiftPointerMove={handleMarqueeMove}
        onShiftPointerUp={handleMarqueeEnd}
        onShiftPointerCancel={handleMarqueeCancel}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            obj={note}
            doc={doc}
            zoom={camera.camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={selection.editingId === note.id}
            onPointerDown={gesture.onObjectPointerDown}
            onDoubleClick={handleNoteDoubleClick}
            onEndEdit={() => selection.endEdit()}
            onBoundary={undo.boundary}
            onUndo={undo.undo}
            onRedo={undo.redo}
          />
        ))}
      </BoardViewport>

      {/* Marquee rectangle (screen space) */}
      <MarqueeRect rect={marquee.rect} camera={camera.camera} />

      {/* Selection overlay with handles (screen space) */}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />

      {/* Selection bar (screen space) */}
      <div className="selection-bar-container" data-vidi6="selection-bar-container">
        <SelectionBar
          ids={selection.ids}
          snapshot={notes}
          doc={doc}
          onDelete={handleSelectionDelete}
          onColorChange={handleColorChange}
        />
      </div>

      <Toolbar onCreateSticky={handleCreateSticky} disabled={!editable} undo={undo} />
      <ZoomControls
        zoomPercent={zoomPercent(camera.camera)}
        canZoomIn={canZoomIn(camera.camera)}
        canZoomOut={canZoomOut(camera.camera)}
        onZoomIn={() => camera.zoomStep('in')}
        onZoomOut={() => camera.zoomStep('out')}
        onReset={camera.reset}
      />
      <NavigationHint visible={!camera.hasNavigated && notes.length === 0} />
      <ConnectionStatus state={connectionState} />
      <SharePanel boardId={boardId} />
    </div>
  );
}
