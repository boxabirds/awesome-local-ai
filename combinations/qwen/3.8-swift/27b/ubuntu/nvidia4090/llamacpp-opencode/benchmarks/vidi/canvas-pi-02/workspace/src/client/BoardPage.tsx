// Board page (story 3 UI + story 5, share.check / share.share): verifies
// the board exists (GET /api/boards/:id with exponential-backoff retries)
// before rendering the board, shows a spinner while checking, a not-found
// view when the board is gone, and a Share button/panel for the link.

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useCamera } from './canvas/useCamera';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
  type Size,
} from './canvas/camera';
import { installTestHooks } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { useSelection } from './board/useSelection';
import { useBoardKeys } from './board/useBoardKeys';
import { useMarquee, MarqueeRect } from './board/useMarquee';
import { useTransformGesture } from './board/useTransformGesture';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { Toolbar } from './board/Toolbar';
import { createUndo } from './board/undo';
import { useUndo } from './board/useUndo';
import { NOTE_TOOLBAR_GAP_PX } from './objects/NoteToolbar';
import { getObjectType } from './objects/registry';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  setStickyColor,
} from '../shared/board-model';
import { unionRects } from '../shared/geometry';
import {
  STICKY_SIZE_WORLD,
  BOARD_CHECK_MAX_RETRIES,
  BOARD_CHECK_RETRY_BASE_MS,
  BOARD_CHECK_RETRY_MAX_DELAY_MS,
} from '../shared/config';
import { canEdit } from './sync/connectBoard';
import { isValidBoardId } from '../shared/board-id';
import { checkBoard } from './api';
import { NotFound } from './NotFound';
import { ShareButton, SharePanel } from './Share';



/**
 * Board existence check (share.check): tries checkBoard up to
 * BOARD_CHECK_MAX_RETRIES times; a 404 (BoardNotFound) and any transient
 * error are retried with exponential backoff (base doubling, capped). A
 * storage hiccup must not make an existing board appear missing (TC-28).
 */
type ExistenceState = 'checking' | 'retrying' | 'exists' | 'not_found';
type Existence = ExistenceState;

function useBoardExistence(boardId: string): ExistenceState {
  const [state, setState] = useState<Existence>('checking');

  useEffect(() => {
    let cancelled = false;
    const attempt = async (n: number): Promise<void> => {
      try {
        await checkBoard(boardId);
        if (!cancelled) setState('exists');
        return;
      } catch (e) {
        // Both definite (404) and transient (unreachable) errors retry; only
        // exhaustion declares the board missing.
        void e;
      }
      if (n >= BOARD_CHECK_MAX_RETRIES) {
        if (!cancelled) setState('not_found');
        return;
      }
      if (!cancelled) setState('retrying');
      const delay = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * 2 ** (n - 1),
        BOARD_CHECK_RETRY_MAX_DELAY_MS,
      );
      await new Promise((r) => window.setTimeout(r, delay));
      if (!cancelled) await attempt(n + 1);
    };
    void attempt(1);
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  return state;
}

function useViewportSize(ref: React.RefObject<HTMLDivElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** The board itself: the pre-story-5 App UI, now parameterised by id and
 *  only mounted once the existence check passes.
 *
 *  Story 7 (sel.*): selection, marquee, transform gestures, keyboard
 *  shortcuts and the selection bar/overlay live here; objects render through
 *  the type registry (sel.all_types). */
function Board({ boardId }: { boardId: string }): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(rootRef);
  const camera = useCamera(viewport);
  const { doc, objects, connectionState, connectionRef } = useBoardDoc(boardId);
  const selection = useSelection(objects);
  const [dragging, setDragging] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const docRef = useRef(doc);
  docRef.current = doc;
  const connectionStateRef = useRef(connectionState);
  connectionStateRef.current = connectionState;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Story 4 (persist.client_status): the board is locked while the room
  // reports a load failure; every edit path below checks this flag.
  const editable = canEdit(connectionState);

  // Story 8 (undo.history): one personal undo controller per board doc,
  // tracking LOCAL_ORIGIN only. History is session-only: destroyed on
  // unmount, a fresh controller after reload starts empty (undo.session_only).
  const undoRef = useRef<ReturnType<typeof createUndo> | null>(null);
  if (undoRef.current === null) undoRef.current = createUndo(doc);
  const undoController = undoRef.current;
  useEffect(() => {
    return () => undoController.destroy();
  }, [undoController]);
  const undoApi = useUndo(undoController, editable);

  // Gesture event counters (test hooks) and undo boundaries (story 8):
  // a complete drag/resize is ONE undo step — boundary() at gesture start
  // and end (incl. pointercancel) merges all rAF-frame writes inside it
  // (undo.steps, undo.boundaries).
  const gestureEventsRef = useRef({ start: 0, end: 0 });

  // Generic transform gesture: group move + bounding-box resize (story 7,
  // sel.transform). Owns exactly one pointer at a time.
  const gesture = useTransformGesture({
    doc,
    camera: camera.camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => {
      gestureEventsRef.current.start += 1;
      undoRef.current?.boundary();
    },
    onGestureEnd: () => {
      gestureEventsRef.current.end += 1;
      undoRef.current?.boundary();
    },
    onDraggingChange: setDragging,
  });

  // Shift+drag marquee on empty space (story 7, sel.marquee_ui).
  const marquee = useMarquee(camera.camera, objects, (ids) => selection.setMany(ids, true));

  // Board keyboard shortcuts (story 7, sel.keyboard + story 8 undo.shortcuts):
  // Ctrl+A, Escape, arrows, Shift+arrows, Delete/Backspace, Enter, and
  // Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y undo and redo.
  useBoardKeys({ doc, selection, snapshot: objects, canEdit: editable, undo: undoController });

  useEffect(() => {
    installTestHooks(
      () => cameraRef.current,
      () => docRef.current,
      () => connectionStateRef.current,
      () => connectionRef.current,
      () => [...selectionRef.current.ids],
      () => gestureEventsRef.current,
    );
  }, []);

  const createStickyAtScreen = (p: Point): void => {
    if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
    const world = screenToWorld(cameraRef.current.camera, p);
    // One note creation is one undo step (boundary before and after;
    // the editor's mount boundary then separates typing, undo.steps).
    undoRef.current?.boundary();
    const id = createSticky(doc, world);
    undoRef.current?.boundary();
    if (id !== '') selectionRef.current.startEdit(id);
  };

  const createStickyAtCenter = (): void => {
    createStickyAtScreen({ x: viewport.width / 2, y: viewport.height / 2 });
  };

  const deleteSelection = useCallback((): void => {
    if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
    const ids = [...selectionRef.current.ids];
    if (ids.length === 0) return;
    // One delete (of any number of objects) is one undo step (undo.steps).
    undoRef.current?.boundary();
    deleteObjects(docRef.current, ids);
    undoRef.current?.boundary();
    selectionRef.current.clear();
  }, []);

  // Selection bar anchor: above the selection's bounding box (screen space).
  const selectedObjects = objects.filter((o) => selection.ids.has(o.id));
  const selectedBox = unionRects(selectedObjects.map(objectBounds));
  const barAnchor =
    selectedObjects.length > 0 && selectedBox !== null && !dragging && selection.editingId === null
      ? worldToScreen(camera.camera, { x: selectedBox.x, y: selectedBox.y })
      : null;

  // Viewport culling (story 4, persist.large_board): only mount objects that
  // intersect the visible world rect (with one note-width of margin).
  const viewTopLeft = screenToWorld(camera.camera, { x: 0, y: 0 });
  const viewBottomRight = screenToWorld(camera.camera, {
    x: viewport.width,
    y: viewport.height,
  });
  const margin = STICKY_SIZE_WORLD;
  const visibleObjects = objects.filter((o) => {
    if (selection.ids.has(o.id) || selection.editingId === o.id) return true;
    const b = objectBounds(o);
    return (
      b.x + b.width > viewTopLeft.x - margin &&
      b.x < viewBottomRight.x + margin &&
      b.y + b.height > viewTopLeft.y - margin &&
      b.y < viewBottomRight.y + margin
    );
  });

  return (
    <div className="board-root" ref={rootRef}>
      <div className="board-header">
        <ConnectionStatus state={connectionState} />
        <ShareButton onOpen={() => setShareOpen(true)} />
      </div>
      {shareOpen && <SharePanel boardId={boardId} onClose={() => setShareOpen(false)} />}
      <BoardViewport
        camera={camera}
        onDblClickEmpty={(p) => createStickyAtScreen(p)}
        onEmptyClick={() => {
          if (selection.editingId !== null) selection.endEdit();
          else selection.clear();
        }}
        marquee={marquee}
      >
        <MarqueeRect rect={marquee.rect} camera={camera.camera} />
        {visibleObjects.map((o) => {
          const spec = getObjectType(o.type);
          if (spec === undefined) return null; // unknown type: never rendered (D3)
          const Component = spec.Component;
          return (
            <Component
              key={o.id}
              obj={o}
              doc={doc}
              zoom={camera.camera.zoom}
              selected={selection.ids.has(o.id)}
              editing={selection.editingId === o.id}
              locked={!editable}
              dragging={dragging}
              onPointerDown={gesture.onObjectPointerDown}
              onSelect={selection.click}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
              undo={undoController}
            />
          );
        })}
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      {barAnchor !== null && (
        <div
          className="note-toolbar-anchor"
          data-testid="selection-bar-anchor"
          style={{
            position: 'fixed',
            left: barAnchor.x + (selectedBox!.width * camera.camera.zoom) / 2,
            top: barAnchor.y - NOTE_TOOLBAR_GAP_PX,
            transform: 'translate(-50%, -100%)',
            zIndex: 20,
          }}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={objects}
            disabled={!editable}
            onDelete={deleteSelection}
            onColor={(id, color) => {
              if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
              // One colour change is one undo step (undo.steps).
              undoRef.current?.boundary();
              setStickyColor(doc, id, color);
              undoRef.current?.boundary();
            }}
          />
        </div>
      )}
      <Toolbar onCreateSticky={createStickyAtCenter} disabled={!editable} undo={undoApi} />
      <ZoomControls
        zoomPercent={zoomPercent(camera.camera)}
        canZoomIn={canZoomIn(camera.camera)}
        canZoomOut={canZoomOut(camera.camera)}
        onZoomIn={() => camera.zoomStep('in')}
        onZoomOut={() => camera.zoomStep('out')}
        onReset={() => camera.reset()}
      />
      <NavigationHint visible={!camera.hasNavigated} />
    </div>
  );
}

/** Route handler for /b/:boardId. A malformed id is a definite not-found
 *  (share.not_found): the not-found view shows with no existence request. */
export function BoardPage({ boardId }: { boardId: string }): ReactElement {
  if (!isValidBoardId(boardId)) {
    return <NotFound />;
  }
  return <BoardPageChecked boardId={boardId} />;
}

function BoardPageChecked({ boardId }: { boardId: string }): ReactElement {
  const existence = useBoardExistence(boardId);

  if (existence === 'checking') {
    return (
      <div className="board-loading" data-testid="board-loading">
        <div className="board-loading-spinner" aria-hidden="true" />
        <p>Opening board…</p>
      </div>
    );
  }
  if (existence === 'retrying') {
    return (
      <div className="board-loading" data-testid="board-loading">
        <div className="board-loading-spinner" aria-hidden="true" />
        <p>Couldn't reach vidi6. Retrying…</p>
      </div>
    );
  }
  if (existence === 'not_found') {
    return <NotFound />;
  }
  return <Board boardId={boardId} />;
}
