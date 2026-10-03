/**
 * Board page (story 5, share.pages).
 *
 * - malformed id → Board not found immediately (no request sent)
 * - valid id → "Opening board…" while `checkBoard` runs
 *   - exists → the stories 1–4 board (with the Share panel)
 *   - not_found → Board not found page
 *   - unreachable → "Couldn't reach vidi6. Retrying…" with exponential
 *     backoff (BOARD_CHECK_RETRY_BASE_MS doubling, capped at
 *     RECONNECT_MAX_BACKOFF_MS); the board opens when the service is
 *     reachable again, without a reload
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld } from '../canvas/camera';
import type { Size } from '../canvas/camera';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { ZoomControls } from '../canvas/ZoomControls';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { Toolbar } from '../board/Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { createSticky, deleteObject } from '../../shared/board-model';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

const INITIAL_SIZE: Size = { width: 0, height: 0 };

export function BoardPage(props: { id: string }): JSX.Element {
  const valid = isValidBoardId(props.id);
  const [state, setState] = useState<BoardPageState>(
    valid ? { kind: 'checking', boardId: props.id } : { kind: 'not_found' },
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;
    const doCheck = async () => {
      attempt += 1;
      const currentAttempt = attempt;
      const result = await checkBoard(props.id);
      if (cancelled) return;
      const next = nextBoardPageState(stateRef.current, result, currentAttempt);
      setState(next);
      if (next.kind === 'unreachable') {
        timer = window.setTimeout(doCheck, next.nextRetryMs);
      }
    };
    void doCheck();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [props.id, valid]);

  switch (state.kind) {
    case 'checking':
      return (
        <div
          data-testid="board-checking"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            color: '#555',
          }}
        >
          Opening board…
        </div>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'unreachable':
      return (
        <div
          data-testid="board-unreachable"
          role="status"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            color: '#555',
          }}
        >
          Couldn't reach vidi6. Retrying…
        </div>
      );
    case 'ready':
      return <BoardView boardId={state.boardId} />;
  }
}

/**
 * The stories 1–4 board UI, mounted only once the board's existence has
 * been confirmed. Owns the camera, the Y.Doc and the network connection.
 * Exported so component tests can render the board directly (story 5: the
 * route `/` now renders the home page, not the board).
 */
export function BoardView({ boardId }: { boardId: string }): JSX.Element {
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(INITIAL_SIZE);

  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const controls = useCamera(size);
  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const isLoadFailed = connectionState === 'load-failed';

  // Publish the mapped connection state to the test hook (test builds only).
  useEffect(() => {
    window.__vidi6?.setConnectionState(connectionState);
  }, [connectionState]);

  // Delete during edit: when a selected/being-edited note disappears (e.g.
  // deleted by someone else), end the selection and editing without error.
  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) {
      select(null);
    }
  }, [notes, selectedId, select]);

  // Create a sticky note at a screen point (disabled when load failed)
  const handleCreateAtScreenPoint = useCallback(
    (screenPoint: { x: number; y: number }) => {
      if (isLoadFailed) return;
      const worldPoint = screenToWorld(controls.camera, screenPoint);
      const id = createSticky(doc, worldPoint);
      startEdit(id);
    },
    [doc, controls.camera, startEdit, isLoadFailed],
  );

  // Create from toolbar button (centre of viewport)
  const handleCreateSticky = useCallback(() => {
    if (isLoadFailed) return;
    const centre = { x: size.width / 2, y: size.height / 2 };
    handleCreateAtScreenPoint(centre);
  }, [size, handleCreateAtScreenPoint, isLoadFailed]);

  // Double-click on empty board space
  const handleDblClickEmpty = useCallback(
    (point: { x: number; y: number }) => {
      if (isLoadFailed) return;
      handleCreateAtScreenPoint(point);
    },
    [handleCreateAtScreenPoint, isLoadFailed],
  );

  // Click on empty board space → clear selection
  const handleClickEmpty = useCallback(() => {
    select(null);
  }, [select]);

  // Keyboard handler: Enter to edit, Delete/Backspace to delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (isLoadFailed) return;
      if (e.key === 'Enter' && selectedId && !editingId) {
        e.preventDefault();
        startEdit(selectedId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, editingId, doc, select, startEdit, isLoadFailed]);

  return (
    <div ref={shellRef} style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <BoardViewport
        controls={controls}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={controls.camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={handleCreateSticky} />
      <ZoomControls
        zoomPercent={zoomPercent(controls.camera)}
        canZoomIn={canZoomIn(controls.camera)}
        canZoomOut={canZoomOut(controls.camera)}
        onZoomIn={() => controls.zoomStep('in')}
        onZoomOut={() => controls.zoomStep('out')}
        onReset={controls.reset}
      />
      <NavigationHint visible={!controls.hasNavigated} />
      <ConnectionStatus state={connectionState} />
      <SharePanel boardId={boardId} />
    </div>
  );
}
