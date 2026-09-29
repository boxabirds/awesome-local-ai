/**
 * Story 5: board page (share.open_link, share.not_found, share.unreachable).
 *
 * State machine (not persisted):
 *   id fails BOARD_ID_PATTERN → NotFoundPage (no request is sent)
 *   Checking ("Opening board…") → checkBoard(id)
 *     200 → Ready: mount the stories 1–4 board + the Share panel
 *     404 → NotFoundPage
 *     network/5xx → Unreachable ("Couldn't reach vidi6. Retrying…") →
 *       retry with backoff from BOARD_CHECK_RETRY_BASE_MS, doubling, capped
 *       at RECONNECT_MAX_BACKOFF_MS; timers are cleared on unmount
 */
import { type JSX, useEffect, useState } from 'react';
import { isValidBoardId } from 'src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from 'src/shared/config';
import { checkBoard, type CheckResponse } from '../api';
import { Board } from '../board/Board';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';

type BoardPageStatus = 'checking' | 'unreachable' | 'not_found' | 'exists';

export function BoardPage(props: { id: string }): JSX.Element {
  const { id } = props;
  const [status, setStatus] = useState<BoardPageStatus>(() =>
    isValidBoardId(id) ? 'checking' : 'not_found',
  );

  useEffect(() => {
    // Malformed ids never reach the service (share.not_found negative).
    if (!isValidBoardId(id)) return;
    let cancelled = false;
    let timer: number | null = null;
    let delay = BOARD_CHECK_RETRY_BASE_MS;
    const attempt = async () => {
      const res: CheckResponse = await checkBoard(id);
      if (cancelled) return;
      if (res.kind === 'exists') {
        setStatus('exists');
        return;
      }
      if (res.kind === 'not_found') {
        setStatus('not_found');
        return;
      }
      // Unreachable: retry with exponential backoff (share.unreachable).
      setStatus('unreachable');
      timer = window.setTimeout(() => void attempt(), delay);
      delay = Math.min(delay * 2, RECONNECT_MAX_BACKOFF_MS);
    };
    void attempt();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [id]);

  if (status === 'not_found') return <NotFoundPage />;
  if (status === 'checking') {
    return (
      <main style={centeredStyle}>
        <p data-testid="opening-board">Opening board…</p>
      </main>
    );
  }
  if (status === 'unreachable') {
    return (
      <main style={centeredStyle}>
        <p data-testid="unreachable-board">Couldn't reach vidi6. Retrying…</p>
      </main>
    );
  }
  return (
    <>
      <Board boardId={id} />
      <SharePanel boardId={id} />
    </>
  );
}

const centeredStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#111827',
  color: '#F9FAFB',
  fontSize: 16,
};
