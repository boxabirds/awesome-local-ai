import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '@/shared/config';
import type { ReactElement } from 'react';

/**
 * The Share panel (story 5, share.share_panel).
 *
 *  - "Share" (top-right) opens a small dialog with the board link —
 *    `<origin>/b/<boardId>` — in a read-only input and a "Copy link"
 *    button, plus the note that anyone with the link can view and edit;
 *  - "Copy link" uses the Clipboard API. The confirmation "Link copied"
 *    (with a check mark) shows for LINK_COPIED_MS, then the button returns
 *    to "Copy link";
 *  - if `navigator.clipboard.writeText` is unavailable or rejects (no
 *    permission / insecure context), the input is focused and fully
 *    selected and the hint "Press Ctrl+C (Cmd+C on Mac) to copy" is shown
 *    (the user copies manually);
 *  - Escape or a click outside closes the dialog and returns focus to the
 *    Share button.
 */

export const SHARE_NOTE_TEXT = 'Anyone with this link can view and edit this board.';
export const MANUAL_COPY_TEXT = 'Press Ctrl+C (Cmd+C on Mac) to copy';
export const COPIED_TEXT = 'Link copied';

/** The shareable link for a board (exported for tests). */
export function boardLink(origin: string, boardId: string): string {
  return `${origin}/b/${boardId}`;
}

type CopyState = 'idle' | 'copied' | 'manual';

export function SharePanel({ boardId }: { boardId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<number | undefined>(undefined);

  const link = boardLink(window.location.origin, boardId);

  const close = useCallback((): void => {
    setOpen(false);
    setCopyState('idle');
    // Focus returns to the Share button (a11y).
    shareButtonRef.current?.focus();
  }, []);

  // Escape / click-outside close while open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: PointerEvent): void => {
      const t = e.target;
      if (t instanceof Node) {
        if (panelRef.current?.contains(t)) return;
        if (shareButtonRef.current?.contains(t)) return;
      }
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  // Clear the "copied" confirmation timer on unmount.
  useEffect(
    () => () => {
      if (copiedTimerRef.current !== undefined) window.clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  /** Manual-copy fallback: focus + full selection + hint. */
  const enterManualCopy = useCallback((): void => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
    setCopyState('manual');
  }, []);

  const onCopyClick = useCallback((): void => {
    const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (typeof writeText !== 'function') {
      enterManualCopy();
      return;
    }
    void writeText(link).then(
      () => {
        setCopyState('copied');
        if (copiedTimerRef.current !== undefined) window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = window.setTimeout(() => setCopyState('idle'), LINK_COPIED_MS);
      },
      () => enterManualCopy(),
    );
  }, [link, enterManualCopy]);

  const selectAll = (): void => {
    inputRef.current?.select();
  };

  return (
    <div
      data-testid="share-panel-root"
      style={{ position: 'fixed', top: 16, right: 16, zIndex: 1100 }}
    >
      <button
        ref={shareButtonRef}
        type="button"
        data-testid="share-button"
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: '8px 16px',
          fontSize: 14,
          borderRadius: 8,
          border: '1px solid #bbb',
          background: '#fff',
          cursor: 'pointer',
        }}
      >
        Share
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Share board"
          data-testid="share-dialog"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            width: 340,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            textAlign: 'left',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <input
            ref={inputRef}
            readOnly
            value={link}
            aria-label="Board link"
            data-testid="share-link-input"
            onFocus={selectAll}
            onClick={selectAll}
            style={{
              padding: '6px 8px',
              fontSize: 13,
              borderRadius: 4,
              border: '1px solid #ccc',
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
          <button
            type="button"
            data-testid="copy-link-button"
            onClick={onCopyClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '8px 16px',
              fontSize: 14,
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              background: copyState === 'copied' ? '#2e7d32' : '#1976d2',
              color: '#fff',
            }}
          >
            {copyState === 'copied' && (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M2 7.5l3.5 3.5L12 3.5" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
            )}
            {copyState === 'copied' ? COPIED_TEXT : 'Copy link'}
          </button>
          {copyState === 'manual' && (
            <p role="status" data-testid="manual-copy-message" style={{ margin: 0, fontSize: 12, color: '#555' }}>
              {MANUAL_COPY_TEXT}
            </p>
          )}
          <p data-testid="share-note" style={{ margin: 0, fontSize: 12, color: '#555' }}>
            {SHARE_NOTE_TEXT}
          </p>
        </div>
      )}
    </div>
  );
}
