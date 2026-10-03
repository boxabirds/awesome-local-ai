import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { checkBoard } from '../api';
import { BoardViewport } from '../canvas/BoardViewport';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import { registerVidi6Hook } from '../canvas/testHooks';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { Toolbar } from '../board/Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { createSticky, deleteObject } from '../../shared/board-model';
import { isValidBoardId } from '../../shared/board-id';
import { SharePanel } from '../share/SharePanel';
import { nextBoardPageState, type BoardPageState } from './state';
import { NotFoundPage } from './NotFoundPage';

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * The board UI (stories 1–4), mounted only when the board page has confirmed
 * the board exists (share.open_link: full editing, no sign-in).
 */
function Board({ boardId }: { boardId: string }): JSX.Element {
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const cameraRef = useRef<Camera>(INITIAL_CAMERA);

  const handleCamera = useCallback((cam: Camera) => {
    cameraRef.current = cam;
    setCamera(cam);
  }, []);

  // Test hook for e2e (drives the production build via `wrangler dev`)
  useEffect(() => {
    registerVidi6Hook({
      getDoc: () => doc,
      createNotes: (n: number) => {
        const ids: string[] = [];
        for (let i = 0; i < n; i++) {
          const x = 200 + (i % 20) * 220;
          const y = 200 + Math.floor(i / 20) * 220;
          const id = createSticky(doc, { x, y }, 'yellow');
          if (id) ids.push(id);
        }
        return ids;
      },
    });
    // Expose connection state for nightly tests
    (window as any).__vidi6 = {
      ...(window as any).__vidi6,
      connectionState,
    };
  }, [doc, connectionState]);

  /** Creates a sticky note centred on a screen point, selects it, starts editing. */
  const createStickyAtScreen = useCallback(
    (p: Point) => {
      const world = screenToWorld(cameraRef.current, p);
      const id = createSticky(doc, world);
      if (id) {
        select(id);
        startEdit(id);
      }
    },
    [doc, select, startEdit],
  );

  /** Creates a sticky note at the centre of the visible board area. */
  const createStickyAtCentre = useCallback(() => {
    createStickyAtScreen({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }, [createStickyAtScreen]);

  // Clear selection/editing when the selected note is deleted remotely
  useEffect(() => {
    if (selectedId !== null) {
      const obj = doc.getMap('objects').get(selectedId);
      if (!obj) {
        select(null);
      }
    }
    if (editingId !== null) {
      const obj = doc.getMap('objects').get(editingId);
      if (!obj) {
        endEdit('unselected');
      }
    }
  }, [notes, selectedId, editingId, doc, select, endEdit]);

  // Keyboard: Enter edits the selected note; Delete/Backspace delete it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (inField || editingId !== null || selectedId === null) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (deleteObject(doc, selectedId)) {
          select(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, doc, select, startEdit]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        onCamera={handleCamera}
        onEmptyDoubleClick={createStickyAtScreen}
        onEmptyClick={() => select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyAtCentre} />
      <SharePanel boardId={boardId} />
    </>
  );
}

/**
 * Board page (share.open_link / share.not_found / share.unreachable).
 *
 * - Malformed id → Board not found, no request sent.
 * - Valid id → "Opening board…" while `checkBoard` runs; `exists` → the board
 *   (stories 1–4 UI + Share panel); `not_found` → Board not found;
 *   `unreachable` → "Couldn't reach vidi6. Retrying…" with exponential
 *   backoff (BOARD_CHECK_RETRY_BASE_MS, capped at RECONNECT_MAX_BACKOFF_MS),
 *   reaching ready or not found without a reload.
 */
export function BoardPage({ id }: { id: string }): JSX.Element {
  if (!isValidBoardId(id)) {
    return <NotFoundPage />;
  }
  return <BoardCheck id={id} />;
}

function BoardCheck({ id }: { id: string }): JSX.Element {
  const [state, setState] = useState<BoardPageState>({ kind: 'checking' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const runCheck = (attempt: number) => {
      checkBoard(id).then((result) => {
        if (cancelled) return;
        const next = nextBoardPageState({ kind: 'checking' }, result, attempt);
        if (next.kind === 'ready') {
          setState({ kind: 'ready', boardId: id });
        } else {
          setState(next);
          if (next.kind === 'unreachable') {
            timerRef.current = setTimeout(() => runCheck(attempt + 1), next.nextRetryMs);
          }
        }
      });
    };

    runCheck(1);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [id]);

  switch (state.kind) {
    case 'checking':
      return (
        <div data-testid="board-checking" style={pageStyle}>
          <p>Opening board…</p>
        </div>
      );
    case 'ready':
      return <Board boardId={id} />;
    case 'not_found':
      return <NotFoundPage />;
    case 'unreachable':
      return (
        <div data-testid="board-unreachable" style={pageStyle}>
          <p>Couldn't reach vidi6. Retrying…</p>
        </div>
      );
  }
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'system-ui, sans-serif',
  background: '#FAFAFA',
  color: '#555',
};
