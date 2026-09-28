// Board page (story 3 UI + story 5, share.check / share.share): verifies
// the board exists (GET /api/boards/:id with exponential-backoff retries)
// before rendering the board, shows a spinner while checking, a not-found
// view when the board is gone, and a Share button/panel for the link.

import { useEffect, useRef, useState, type ReactElement } from 'react';
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
import { Toolbar } from './board/Toolbar';
import { NOTE_TOOLBAR_GAP_PX, NoteToolbar } from './objects/NoteToolbar';
import { StickyNote } from './objects/StickyNote';
import { deleteObject, setStickyColor, createSticky } from '../shared/board-model';
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
 *  only mounted once the existence check passes. */
function Board({ boardId }: { boardId: string }): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(rootRef);
  const camera = useCamera(viewport);
  const { doc, notes, connectionState, connectionRef } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const [dragging, setDragging] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const docRef = useRef(doc);
  docRef.current = doc;
  const connectionStateRef = useRef(connectionState);
  connectionStateRef.current = connectionState;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    installTestHooks(
      () => cameraRef.current,
      () => docRef.current,
      () => connectionStateRef.current,
      () => connectionRef.current,
      () => selectedIdRef.current,
    );
  }, []);

  // A note deleted from under the selection (keyboard, toolbar, or a
  // concurrent client) clears selection and editing, ending any edit.
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) select(null);
    if (editingId !== null && !notes.some((n) => n.id === editingId)) endEdit('unselected');
  }, [notes, selectedId, editingId, select, endEdit]);

  // Story 4 (persist.client_status): the board is locked while the room
  // reports a load failure; every edit path below checks this flag.
  const editable = canEdit(connectionState);

  // Window keyboard: Enter starts editing the selected note; Delete/Backspace
  // delete it. Ignored while editing text (the textarea owns those keys) and
  // when focus is in any input.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (editingId !== null) return;
      if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (selectedId === null) return; // nothing selected: nothing happens
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (deleteObject(doc, selectedId)) select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, startEdit, select, doc]);

  const createStickyAtScreen = (p: Point): void => {
    if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
    const world = screenToWorld(cameraRef.current.camera, p);
    const id = createSticky(doc, world);
    if (id !== '') startEdit(id);
  };

  const createStickyAtCenter = (): void => {
    createStickyAtScreen({ x: viewport.width / 2, y: viewport.height / 2 });
  };

  const selectedNote = selectedId !== null ? notes.find((n) => n.id === selectedId) ?? null : null;
  const noteTopLeft =
    selectedNote !== null ? worldToScreen(camera.camera, { x: selectedNote.x, y: selectedNote.y }) : null;

  // Viewport culling (story 4, persist.large_board): only mount notes that
  // intersect the visible world rect (with one note-width of margin).
  const viewTopLeft = screenToWorld(camera.camera, { x: 0, y: 0 });
  const viewBottomRight = screenToWorld(camera.camera, {
    x: viewport.width,
    y: viewport.height,
  });
  const margin = STICKY_SIZE_WORLD;
  const visibleNotes = notes.filter(
    (n) =>
      n.id === selectedId ||
      n.id === editingId ||
      (n.x + STICKY_SIZE_WORLD > viewTopLeft.x - margin &&
        n.x < viewBottomRight.x + margin &&
        n.y + STICKY_SIZE_WORLD > viewTopLeft.y - margin &&
        n.y < viewBottomRight.y + margin),
  );

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
          if (editingId !== null) endEdit('unselected');
          else select(null);
        }}
      >
        {visibleNotes.map((n) => (
          <StickyNote
            key={n.id}
            note={n}
            doc={doc}
            zoom={camera.camera.zoom}
            selected={n.id === selectedId}
            editing={n.id === editingId}
            locked={!editable}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            onDraggingChange={setDragging}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyAtCenter} disabled={!editable} />
      {selectedNote !== null && noteTopLeft !== null && !editingId && !dragging && (
        <div
          className="note-toolbar-anchor"
          data-testid="note-toolbar-anchor"
          style={{
            position: 'fixed',
            left: noteTopLeft.x + (STICKY_SIZE_WORLD * camera.camera.zoom) / 2,
            top: noteTopLeft.y - NOTE_TOOLBAR_GAP_PX,
            transform: 'translate(-50%, -100%)',
            zIndex: 20,
          }}
        >
          <NoteToolbar
            color={selectedNote.color}
            disabled={!editable}
            onColor={(c) => {
              if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
              setStickyColor(doc, selectedNote.id, c);
            }}
            onDelete={() => {
              if (!canEdit(connectionStateRef.current)) return; // load-failed: locked
              deleteObject(doc, selectedNote.id);
              select(null);
            }}
          />
        </div>
      )}
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
