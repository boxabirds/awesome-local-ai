import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObject, setStickyColor } from '../../shared/board-model';
import { isValidBoardId, newBoardId } from '../../shared/board-id';
import { STICKY_SIZE_WORLD } from '../../shared/config';
import { checkBoard } from '../api';
import { Toolbar } from '../board/Toolbar';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useStickyNoteKeys } from '../board/useStickyNoteKeys';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  worldToScreen,
  zoomPercent,
  type Point,
  type Size
} from '../canvas/camera';
import { installTestHooks } from '../canvas/testHooks';
import { BoardCameraContext, useCamera } from '../canvas/useCamera';
import { NoteToolbar } from '../objects/NoteToolbar';
import { StickyNote, STICKY_PADDING_WORLD } from '../objects/StickyNote';
import { SharePanel } from '../share/SharePanel';
import { ConnectionStatus, useConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

const NOTE_TOOLBAR_GAP_PX = 12;

// Editing is disabled only while the board cannot be loaded, so a transient
// storage failure ("Reconnecting…") never locks a readable board (TC-28).
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

// A board id read from /b/<id> for a standalone board (component tests render
// <BoardView/> directly); falls back to a fresh id, as before story 5. Inside
// BoardPage the id is always supplied explicitly.
function resolveLocationBoardId(): string {
  const match = /^\/b\/([^/]+)\/?$/.exec(window.location.pathname);
  if (match !== null && isValidBoardId(match[1])) return match[1];
  const fresh = newBoardId();
  window.history.replaceState(null, '', `/b/${fresh}`);
  return fresh;
}

function measure(el: HTMLElement | null): Size {
  const width = el?.clientWidth || window.innerWidth;
  const height = el?.clientHeight || window.innerHeight;
  return { width, height };
}

export interface BoardViewProps {
  // Tests inject their own Y.Doc; production supplies none (sync via boardId).
  doc?: Y.Doc;
  boardId?: string;
}

// The stories 1–4 board UI, rendered once the board is known to exist. With a
// doc injected it stays offline (component tests); with a boardId it syncs.
export function BoardView({ doc: providedDoc, boardId }: BoardViewProps = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>(() => measure(null));
  useEffect(() => {
    const update = () => {
      const next = measure(rootRef.current);
      setViewport((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next
      );
    };
    update();
    const el = rootRef.current;
    if (typeof ResizeObserver !== 'undefined' && el !== null) {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const board = useCamera(viewport);
  // Injected docs (component tests) stay offline; real boards sync live.
  const [resolvedId] = useState(() => boardId ?? resolveLocationBoardId());
  const { doc, notes, connection } = useBoardDoc(
    providedDoc,
    providedDoc === undefined ? resolvedId : undefined
  );
  const connectionStatus = useConnectionStatus(connection);
  const editable = canEdit(connectionStatus);
  const selection = useSelection();
  const { selectedId, editingId, draggingId, select, startEdit, endEdit, setDragging } =
    selection;

  // A remote peer deleting the note we point at clears the stale references
  // (delete during edit: no dangling toolbar, editor or drag).
  useEffect(() => {
    if (selectedId === null) return;
    if (notes.some((note) => note.id === selectedId)) return;
    select(null);
    setDragging(null);
  }, [notes, selectedId, select, setDragging]);

  useEffect(() => {
    installTestHooks(board.setCamera, doc, connection);
  }, [board.setCamera, doc, connection]);

  useStickyNoteKeys(doc, selection, editable);

  const createAtWorldPoint = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      startEdit(id);
    },
    [doc, startEdit]
  );

  const onDoubleClickEmpty = useCallback(
    (screenPoint: Point) => {
      if (!editable) return; // load-failed board is never editable (TC-23)
      createAtWorldPoint(screenToWorld(board.camera, screenPoint));
    },
    [board.camera, createAtWorldPoint, editable]
  );

  const onCreateSticky = useCallback(() => {
    if (!editable) return; // load-failed board is never editable (TC-23)
    // Centre of the visible board area, wherever the board has been panned.
    createAtWorldPoint(
      screenToWorld(board.camera, { x: viewport.width / 2, y: viewport.height / 2 })
    );
  }, [board.camera, createAtWorldPoint, viewport, editable]);

  const { camera, hasNavigated } = board;
  const selectedNote = selectedId === null ? undefined : notes.find((n) => n.id === selectedId);

  return (
    <BoardCameraContext.Provider value={board}>
      <div
        ref={rootRef}
        className="board-root"
        style={{ '--sticky-padding': `${STICKY_PADDING_WORLD}px` } as React.CSSProperties}
      >
        <ConnectionStatus status={connectionStatus} />
        <BoardViewport
          onDoubleClickEmpty={onDoubleClickEmpty}
          onEmptyClick={() => {
            select(null);
          }}
        >
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={camera.zoom}
              selected={note.id === selectedId}
              editing={note.id === editingId}
              editable={editable}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
              onDraggingChange={setDragging}
            />
          ))}
        </BoardViewport>
        <Toolbar onCreateSticky={onCreateSticky} disabled={!editable} />
        {editable &&
          selectedNote !== undefined &&
          editingId === null &&
          draggingId === null && (
          <div
            className="note-toolbar-anchor"
            style={{
              left: worldToScreen(camera, {
                x: selectedNote.x + STICKY_SIZE_WORLD / 2,
                y: selectedNote.y
              }).x,
              top:
                worldToScreen(camera, { x: selectedNote.x, y: selectedNote.y }).y -
                NOTE_TOOLBAR_GAP_PX
            }}
          >
            <NoteToolbar
              color={selectedNote.color}
              onColor={(color) => {
                setStickyColor(doc, selectedNote.id, color);
              }}
              onDelete={() => {
                deleteObject(doc, selectedNote.id);
                select(null);
              }}
            />
          </div>
        )}
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        <NavigationHint visible={!hasNavigated} />
      </div>
    </BoardCameraContext.Provider>
  );
}

// Opening a board link (share.open_link / not_found / unreachable): validate
// the id shape first (malformed → not found, no request), then poll existence
// with exponential backoff while the service is unreachable. The board UI is
// mounted only once the board is known to exist.
export function BoardPage({ id }: { id: string }) {
  const [state, setState] = useState<BoardPageState>(() =>
    isValidBoardId(id) ? { kind: 'checking' } : { kind: 'not_found' }
  );
  const stateRef = useRef(state);

  useEffect(() => {
    if (!isValidBoardId(id)) {
      const notFound: BoardPageState = { kind: 'not_found' };
      stateRef.current = notFound;
      setState(notFound);
      return;
    }
    const checking: BoardPageState = { kind: 'checking' };
    stateRef.current = checking;
    setState(checking);

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      const result = await checkBoard(id);
      if (cancelled) return;
      const prev = stateRef.current;
      const attempt = prev.kind === 'unreachable' ? prev.attempt : 0;
      const next = nextBoardPageState(prev, result, attempt, id);
      stateRef.current = next;
      setState(next);
      if (next.kind === 'unreachable') {
        timer = setTimeout(run, next.nextRetryMs);
      }
    };
    run();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [id]);

  if (state.kind === 'checking') {
    return (
      <main className="page board-loading" role="status">
        Opening board…
      </main>
    );
  }
  if (state.kind === 'not_found') return <NotFoundPage />;
  if (state.kind === 'unreachable') {
    return (
      <main className="page board-unreachable" role="status">
        Couldn't reach vidi6. Retrying…
      </main>
    );
  }
  return (
    <>
      <BoardView boardId={id} />
      <SharePanel boardId={id} />
    </>
  );
}
