/**
 * Board page (story 5, share.pages).
 *
 * States:
 *   malformed id    → NotFoundPage (no request sent)
 *   checking        → "Opening board…"
 *   ready           → board UI (stories 1-4) + SharePanel
 *   not_found       → NotFoundPage
 *   unreachable     → "Couldn't reach vidi6. Retrying…" with backoff
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import { checkBoard } from '../api';
import { NotFoundPage } from './NotFoundPage';
import { SharePanel } from '../share/SharePanel';
import type { Size } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';

/**
 * Edit gate: the board is editable in every phase except `load_failed`
 * (room rejected the sync; retrying). `null` (local mode / test harness) is
 * editable.
 */
export function canEdit(phase: ConnectionState | null): boolean {
  return phase !== 'load_failed';
}
import { canZoomIn, canZoomOut, zoomPercent } from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useBoardActions } from '../board/useBoardActions';
import { useBoardKeyboard } from '../board/useBoardKeyboard';
import { Toolbar } from '../board/Toolbar';
import { StickyNote } from '../objects/StickyNote';

type BoardPageState = 'checking' | 'ready' | 'not_found' | 'unreachable';

export function BoardPage({ id }: { id: string }) {
  // Malformed id → immediate NotFoundPage, no request.
  if (!isValidBoardId(id)) {
    return <NotFoundPage />;
  }
  return <BoardPageInner id={id} />;
}

function BoardPageInner({ id }: { id: string }) {
  const [state, setState] = useState<BoardPageState>('checking');
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const unmountedRef = useRef(false);

  // Board existence check with exponential backoff.
  const doCheck = useCallback(async () => {
    const result = await checkBoard(id);
    if (unmountedRef.current) return;
    if (result.kind === 'exists') {
      setState('ready');
    } else if (result.kind === 'not_found') {
      setState('not_found');
    } else {
      // unreachable: schedule a retry with exponential backoff
      setState('unreachable');
      const attempt = attemptRef.current;
      attemptRef.current += 1;
      const delay = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt,
        RECONNECT_MAX_BACKOFF_MS,
      );
      retryTimerRef.current = setTimeout(() => {
        doCheck();
      }, delay);
    }
  }, [id]);

  useEffect(() => {
    unmountedRef.current = false;
    doCheck();
    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [doCheck]);

  if (state === 'checking') {
    return (
      <div className="vidi6-board-loading" data-testid="board-loading">
        Opening board…
      </div>
    );
  }

  if (state === 'not_found') {
    return <NotFoundPage />;
  }

  if (state === 'unreachable') {
    return (
      <div className="vidi6-board-unreachable" data-testid="board-unreachable">
        Couldn't reach vidi6. Retrying…
      </div>
    );
  }

  // state === 'ready': render the board UI
  return <BoardContent id={id} />;
}

/**
 * The actual board UI (stories 1-4). Rendered only when the board exists.
 */
function BoardContent({ id }: { id: string }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const api = useCamera(size);
  const { doc, notes, connectionPhase } = useBoardDoc(id);
  const selection = useSelection();
  const editable = canEdit(connectionPhase);
  const actions = useBoardActions({ doc, api, size, selection, editable });
  useBoardKeyboard({ doc, selection, editable });

  return (
    <div className="vidi6-shell" ref={shellRef}>
      <BoardViewport
        api={api}
        onCreateStickyAt={actions.createAtScreenPoint}
        onEmptyClick={() => selection.select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={api.camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            editable={editable}
            onSelect={selection.select}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={actions.createAtCentre} disabled={!editable} />
      <ConnectionStatus phase={connectionPhase} />
      <ZoomControls
        zoomPercent={zoomPercent(api.camera)}
        canZoomIn={canZoomIn(api.camera)}
        canZoomOut={canZoomOut(api.camera)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
      <SharePanel boardId={id} />
    </div>
  );
}
