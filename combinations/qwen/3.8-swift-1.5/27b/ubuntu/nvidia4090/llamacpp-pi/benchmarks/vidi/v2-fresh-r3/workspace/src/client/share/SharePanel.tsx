import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The full link of a board, ready to paste (share.copy). */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type ShareState = 'closed' | 'open' | 'copied' | 'manual_copy';

const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

/**
 * Share button + panel (share.share_panel).
 *
 * - Button "Share" (top-right of the board page).
 * - Panel `role="dialog" aria-label="Share board"` with a read-only link
 *   field (clicking it selects the whole link), a "Copy link" button and the
 *   note "Anyone with this link can view and edit this board."
 * - Copy: `navigator.clipboard.writeText(link)`; on success the button shows
 *   "Link copied" (with a tick) for LINK_COPIED_MS; when the clipboard API is
 *   missing or rejects, the field text is selected and
 *   "Press Ctrl+C (Cmd+C on Mac) to copy" is shown.
 * - Closes on Escape and on pointerdown outside; focus returns to the Share
 *   button.
 */
export function SharePanel({ boardId }: { boardId: string }): JSX.Element {
  const [state, setState] = useState<ShareState>('closed');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);
  const open = state !== 'closed';

  const close = useCallback(() => {
    setState('closed');
    if (revertTimer.current) {
      clearTimeout(revertTimer.current);
      revertTimer.current = null;
    }
    buttonRef.current?.focus();
  }, []);

  /** Selects the whole link in the field (PRD field behaviour). */
  const selectLink = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  const copy = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(link);
        setState('copied');
        revertTimer.current = setTimeout(() => setState('open'), LINK_COPIED_MS);
        return;
      } catch {
        // rejected (permission or insecure context) → manual copy below
      }
    }
    // Clipboard API missing or rejected: select the text and tell the user.
    selectLink();
    setState('manual_copy');
  }, [link, selectLink]);

  // Escape closes the panel (while open).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  // Pointerdown outside the panel (and outside the Share button) closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        target !== buttonRef.current
      ) {
        close();
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Clear any pending "Link copied" revert timer on unmount.
  useEffect(() => {
    return () => {
      if (revertTimer.current) clearTimeout(revertTimer.current);
    };
  }, []);

  return (
    <div
      data-testid="share-widget"
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 1001,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-testid="share-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setState('open')}
        style={{
          padding: '8px 16px',
          fontSize: 14,
          borderRadius: 8,
          border: '1px solid rgba(0,0,0,0.15)',
          background: '#fff',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
      >
        Share
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Share board"
          data-testid="share-panel"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 320,
            padding: 12,
            borderRadius: 10,
            background: '#fff',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <input
            ref={inputRef}
            readOnly
            aria-label="Board link"
            data-testid="share-link-input"
            value={link}
            onClick={selectLink}
            onFocus={selectLink}
            style={{
              padding: '6px 8px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid rgba(0,0,0,0.2)',
              background: '#F5F5F5',
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
          <button
            type="button"
            data-testid="copy-link-button"
            onClick={() => {
              void copy();
            }}
            style={{
              padding: '8px 12px',
              fontSize: 14,
              borderRadius: 6,
              border: 'none',
              background: state === 'copied' ? '#10B981' : '#2563EB',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {state === 'copied' ? (
              <>
                <span aria-hidden>✓ </span>
                Link copied
              </>
            ) : (
              'Copy link'
            )}
          </button>
          {state === 'manual_copy' && (
            <p data-testid="manual-copy-message" style={{ margin: 0, fontSize: 13, color: '#555' }}>
              {MANUAL_COPY_MESSAGE}
            </p>
          )}
          <p className="share-note" style={{ margin: 0, fontSize: 12, color: '#777' }}>
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </div>
  );
}
