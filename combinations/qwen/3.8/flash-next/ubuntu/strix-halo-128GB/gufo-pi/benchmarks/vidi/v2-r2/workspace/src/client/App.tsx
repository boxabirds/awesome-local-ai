import { useCallback, useEffect, useMemo, useRef, type ReactElement } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { useBoard } from './canvas/BoardContext';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { type Camera, zoomPercent, canZoomIn, canZoomOut, worldToScreen } from './canvas/camera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useMarquee } from './board/Marquee';
import { useUndo } from './board/useUndo';
import { createUndo, type UndoController } from './board/undo';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { NoteLayer } from './objects/NoteLayer';
import { NoteToolbar } from './objects/NoteToolbar';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import {
  createSticky,
  deleteObjects,
  setStickyColor,
  objectBounds,
  objectsInRect,
} from '@shared/board-model';
import type { Rect } from '@shared/geometry';
import { type StickyColor } from '@shared/config';
import type { Point } from '@client/canvas/camera';

/**
 * Editing is disabled only while the board cannot be loaded (load_failed). All
 * other connection states (connecting/connected/reconnecting/confirmed) allow
 * editing so a transient storage hiccup never locks the user out.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

function BoardOverlay(): ReactElement {
  const { camera, hasNavigated, zoomStep, reset } = useBoard();
  return (
    <>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}

export function Board({ boardId }: { boardId: string }): ReactElement {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const editable = canEdit(connectionState);
  const selection = useSelection(notes);

  // Camera ref - updated by BoardViewport on every render
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });

  // Undo controller: one per board doc, destroyed on board change/unmount
  const undoController: UndoController | null = useMemo(() => {
    if (!doc) return null;
    return createUndo(doc);
  }, [doc]);

  // Destroy previous controller when board changes or component unmounts
  useEffect(() => {
    return () => {
      if (undoController) undoController.destroy();
    };
  }, [undoController]);

  // Undo state for buttons and shortcuts
  const undoState = useUndo(undoController, editable);

  // Transform gesture (group move and resize) with boundary hooks
  const { onObjectPointerDown, onHandlePointerDown } = useTransformGesture({
    doc,
    cameraRef,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: undoController ? () => undoController.boundary() : undefined,
    onGestureEnd: undoController ? () => undoController.boundary() : undefined,
  });

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: editable,
    undoController,
  });

  // Marquee
  const marquee = useMarquee(cameraRef, (ids) => {
    selection.setMany(ids, true);
  }, (rect: Rect) => objectsInRect(notes, rect));

  const handleCreateSticky = useCallback(
    (worldPoint: Point) => {
      if (!editable) return;
      if (undoController) undoController.boundary();
      const id = createSticky(doc, worldPoint);
      if (undoController) undoController.boundary();
      if (id) {
        selection.startEdit(id);
      }
    },
    [doc, selection, editable, undoController],
  );

  const handleEmptyDoubleClick = useCallback(
    (worldPoint: Point) => {
      handleCreateSticky(worldPoint);
    },
    [handleCreateSticky],
  );

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  const handleColorChange = useCallback(
    (color: StickyColor) => {
      if (!editable) return;
      if (selection.ids.size === 1) {
        const id = [...selection.ids][0];
        if (undoController) undoController.boundary();
        setStickyColor(doc, id, color);
        if (undoController) undoController.boundary();
      }
    },
    [doc, selection, editable, undoController],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    if (selection.ids.size > 0) {
      if (undoController) undoController.boundary();
      deleteObjects(doc, [...selection.ids]);
      if (undoController) undoController.boundary();
      selection.clear();
    }
  }, [doc, selection, editable, undoController]);

  // Determine which object to show NoteToolbar for (single sticky, not editing)
  const singleSticky: import('@shared/board-model').StickySnapshot | null =
    selection.ids.size === 1 && !selection.editingId
      ? (notes.find((n) => n.id === [...selection.ids][0] && n.type === 'sticky') ?? null)
      : null;

  return (
    <div className="vidi6-app">
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        cameraRef={cameraRef}
        onEmptyDoubleClick={handleEmptyDoubleClick}
        onEmptyClick={handleEmptyClick}
        onMarqueeBegin={(screen) => marquee.begin(screen)}
        onMarqueeMove={(screen) => marquee.move(screen)}
        onMarqueeEnd={() => marquee.end()}
        onMarqueeCancel={() => marquee.cancel()}
        overlay={
          <AppChrome
            doc={doc}
            notes={notes}
            selection={selection}
            singleSticky={singleSticky}
            editable={editable}
            onColorChange={handleColorChange}
            onDelete={handleDelete}
            onCreateSticky={handleCreateSticky}
            onHandlePointerDown={onHandlePointerDown}
            undoState={undoState}
          />
        }
      >
        <NoteLayer
          notes={notes}
          doc={doc}
          selection={selection}
          editable={editable}
          onObjectPointerDown={onObjectPointerDown}
          onStartEdit={selection.startEdit}
          onEndEdit={() => selection.endEdit()}
          undoController={undoController}
        />
      </BoardViewport>
    </div>
  );
}



interface AppChromeProps {
  doc: import('yjs').Doc;
  notes: readonly import('@shared/board-model').StickySnapshot[];
  selection: import('./board/useSelection').SelectionApi;
  singleSticky: import('@shared/board-model').StickySnapshot | null;
  editable: boolean;
  onColorChange(c: StickyColor): void;
  onDelete(): void;
  onCreateSticky(p: Point): void;
  onHandlePointerDown(e: PointerEvent, h: import('@shared/geometry').Handle): void;
  undoState: ReturnType<typeof useUndo>;
}

function AppChrome(props: AppChromeProps): ReactElement {
  const { camera, viewport } = useBoard();
  const { selection } = props;

  const handleCreateFromToolbar = useCallback(() => {
    const worldPoint: Point = {
      x: camera.x + viewport.width / 2 / camera.zoom,
      y: camera.y + viewport.height / 2 / camera.zoom,
    };
    props.onCreateSticky(worldPoint);
  }, [camera, viewport, props]);

  return (
    <>
      <BoardOverlay />
      <Toolbar
        onCreateSticky={handleCreateFromToolbar}
        disabled={!props.editable}
        undo={props.undoState}
      />

      {/* Selection overlay (bounding box + handles) */}
      {selection.ids.size > 0 && (
        <SelectionOverlay
          ids={selection.ids}
          snapshot={props.notes}
          camera={camera}
          onHandlePointerDown={props.onHandlePointerDown}
        />
      )}

      {/* Selection bar for 2+ selected */}
      {selection.ids.size >= 2 && (
        <SelectionBar
          ids={selection.ids}
          snapshot={props.notes}
          camera={camera}
          onDelete={props.onDelete}
        />
      )}

      {/* NoteToolbar for single sticky */}
      {props.singleSticky && !props.selection.editingId && (
        <NoteToolbarScreenSpace
          note={props.singleSticky}
          camera={camera}
          onColor={props.onColorChange}
          onDelete={props.onDelete}
        />
      )}
    </>
  );
}

function NoteToolbarScreenSpace({
  note,
  camera,
  onColor,
  onDelete,
}: {
  note: import('@shared/board-model').StickySnapshot;
  camera: { x: number; y: number; zoom: number };
  onColor(c: StickyColor): void;
  onDelete(): void;
}): ReactElement {
  const bounds = objectBounds(note);
  const screenPos = worldToScreen(camera, {
    x: bounds.x + bounds.width / 2,
    y: bounds.y,
  });

  return (
    <div
      style={{
        position: 'fixed',
        left: screenPos.x,
        top: screenPos.y - 40,
        transform: 'translateX(-50%)',
        zIndex: 20,
      }}
    >
      <NoteToolbar color={note.color} onColor={onColor} onDelete={onDelete} />
    </div>
  );
}

/**
 * Top-level router (story 5): `/` -> Home, `/b/:id` -> Board page, anything else
 * -> Board not found.
 */
export function App(): ReactElement {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage id={route.id} />;
  return <NotFoundPage />;
}
