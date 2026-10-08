import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { CameraContext, useCamera } from './canvas/useCamera';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
} from './canvas/camera';
import { installVidi6TestHooks, updateVidi6ConnectionState } from './canvas/testHooks';
import { newBoardId, isValidBoardId } from '../shared/board-id';
import { ConnectionStatus } from './sync/ConnectionStatus';
import {
  createSticky,
  deleteObject,
  renderOrder,
  setStickyColor,
  type StickySnapshot,
} from '../shared/board-model';
import { STICKY_SIZE_WORLD, type StickyColor } from '../shared/config';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useStickyKeyboard } from './board/useStickyKeyboard';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';

/** Board background colour (the dot grid is drawn on top). */
const BOARD_BACKGROUND = '#f8f8f6';
/** Origin marker (small crosshair at world 0,0): a stable e2e pixel target. */
const ORIGIN_MARKER_HALF_PX = 6;
const ORIGIN_MARKER_COLOR = '#8f8f86';

/**
 * The board id from `/b/:boardId`, or null when the path is not a board
 * address. In story 3 a board is reached purely by its address; story 5
 * replaces the client-side fallback with server-side board creation.
 */
function boardIdFromLocation(): string | null {
  const match = window.location.pathname.match(/^\/b\/([^/]+)$/);
  return match !== null ? decodeURIComponent(match[1] ?? '') : null;
}

/**
 * Small crosshair at the board's starting point (world 0,0), rendered in
 * all builds so e2e tests have a stable pixel target.
 */
function OriginMarker(): JSX.Element {
  return (
    <div
      data-testid="origin-marker"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: -ORIGIN_MARKER_HALF_PX,
        top: -ORIGIN_MARKER_HALF_PX,
        width: ORIGIN_MARKER_HALF_PX * 2,
        height: ORIGIN_MARKER_HALF_PX * 2,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: ORIGIN_MARKER_HALF_PX - 0.5,
          width: '100%',
          height: 1,
          background: ORIGIN_MARKER_COLOR,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: ORIGIN_MARKER_HALF_PX - 0.5,
          top: 0,
          width: 1,
          height: '100%',
          background: ORIGIN_MARKER_COLOR,
        }}
      />
    </div>
  );
}

/**
 * Resolves the board id for this tab: a valid `/b/<id>` path is used as-is;
 * anything else (`/` or an invalid id) redirects to a fresh board. The
 * redirect is a hard `location.replace` so the address bar shows the board
 * the tab is actually working on.
 */
function useBoardId(): string | null {
  const [boardId] = useState<string | null>(() => {
    const fromPath = boardIdFromLocation();
    if (fromPath !== null && isValidBoardId(fromPath)) {
      return fromPath;
    }
    window.location.replace(`/b/${newBoardId()}`);
    return null;
  });
  return boardId;
}

export function App(): JSX.Element {
  const boardId = useBoardId();
  if (boardId === null) {
    // Redirecting to /b/<newBoardId()>; the page reloads.
    return <></>;
  }
  return <Board boardId={boardId} />;
}

function Board({ boardId }: { boardId: string }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth || 1,
    height: window.innerHeight || 1,
  }));

  // Viewport size from a ResizeObserver (window resize never moves content:
  // the camera is anchored to the top-left and carries no size).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) {
      return;
    }
    const update = (): void => {
      setViewport((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    // Fallback for environments without ResizeObserver (e.g. jsdom).
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const cameraController = useCamera(viewport);
  const { doc, objects, connectionState, dropSocket, resumeSocket } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useStickyKeyboard({ doc, selectedId, editingId, select, startEdit });

  // If the selected / editing note disappears (deleted elsewhere), clear the
  // stale local state so nothing points at a ghost (TC-37).
  useEffect(() => {
    if (selectedId !== null && !objects.some((o) => o.id === selectedId)) {
      select(null);
    }
    if (editingId !== null && !objects.some((o) => o.id === editingId)) {
      endEdit('unselected');
    }
  }, [objects, selectedId, editingId, select, endEdit]);

  /** Create a sticky note centred on a viewport-local point and start editing it. */
  const createAt = useCallback(
    (p: Point): void => {
      const id = createSticky(doc, screenToWorld(cameraController.camera, p));
      if (id !== '') {
        startEdit(id);
      }
    },
    [doc, cameraController.camera, startEdit],
  );

  const createAtCentre = useCallback((): void => {
    createAt({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAt, viewport]);

  // Test-only hooks (no-ops and tree-shaken in production builds).
  const objectsRef = useRef<readonly StickySnapshot[]>(objects);
  objectsRef.current = objects;
  useEffect(() => {
    installVidi6TestHooks(
      cameraController.setCamera,
      () => objectsRef.current,
      dropSocket,
      resumeSocket,
    );
  }, [cameraController.setCamera, dropSocket, resumeSocket]);

  // Keep the test hook's live connection state current (no-op in production).
  useEffect(() => {
    updateVidi6ConnectionState(connectionState);
  }, [connectionState]);

  const selectedNote =
    selectedId !== null ? objects.find((o) => o.id === selectedId) : undefined;
  const noteToolbarVisible =
    selectedNote !== undefined &&
    editingId !== selectedNote.id &&
    draggingId !== selectedNote.id;

  return (
    <CameraContext.Provider value={cameraController}>
      <div
        ref={rootRef}
        data-testid="app-root"
        style={{ position: 'fixed', inset: 0, background: BOARD_BACKGROUND }}
      >
        <BoardViewport onDoubleClickEmpty={createAt} onEmptyClick={() => select(null)}>
          <OriginMarker />
          {/* Stable DOM order (renderOrder): a DOM move would release pointer
              capture and kill an in-flight drag; stacking is CSS z-index. */}
          {renderOrder(objects).map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={cameraController.camera.zoom}
              selected={selectedId === note.id}
              editing={editingId === note.id}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
              onDraggingChange={setDraggingId}
            />
          ))}
        </BoardViewport>
        <Toolbar onCreateSticky={createAtCentre} />
        <ConnectionStatus state={connectionState} />
        {noteToolbarVisible && selectedNote !== undefined && (
          <div
            style={{
              position: 'fixed',
              left:
                worldToScreen(cameraController.camera, {
                  x: selectedNote.x,
                  y: selectedNote.y,
                }).x + (STICKY_SIZE_WORLD * cameraController.camera.zoom) / 2,
              top:
                worldToScreen(cameraController.camera, {
                  x: selectedNote.x,
                  y: selectedNote.y,
                }).y - 10,
              transform: 'translate(-50%, -100%)',
              zIndex: 3000,
            }}
          >
            <NoteToolbar
              color={selectedNote.color}
              onColor={(c: StickyColor) => {
                setStickyColor(doc, selectedNote.id, c);
              }}
              onDelete={() => {
                if (deleteObject(doc, selectedNote.id)) {
                  select(null);
                }
              }}
            />
          </div>
        )}
        <ZoomControls
          zoomPercent={zoomPercent(cameraController.camera)}
          canZoomIn={canZoomIn(cameraController.camera)}
          canZoomOut={canZoomOut(cameraController.camera)}
          onZoomIn={() => cameraController.zoomStep('in')}
          onZoomOut={() => cameraController.zoomStep('out')}
          onReset={cameraController.reset}
        />
        <NavigationHint visible={!cameraController.hasNavigated} />
      </div>
    </CameraContext.Provider>
  );
}
