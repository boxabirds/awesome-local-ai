// Share panel (share.share_panel).
//
// A "Share" button (top-right) that opens a small panel containing the board's
// full link in a read-only field, a "Copy link" button and the security note.
//
// State machine: Closed → Open → (Copied | ManualCopy) → Open/Closed.
//   * Copy succeeds → "Link copied" for LINK_COPIED_MS, then back to Open.
//   * Clipboard API missing OR writeText rejects → ManualCopy: the field's
//     whole value is selected, focused, and "Press Ctrl+C (Cmd+C on Mac) to
//     copy" is shown (browsers differ on clipboard permission, so the fallback
//     is always available).
//   * Escape or a pointerdown outside the panel closes it; focus returns to the
//     Share button.

import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The shareable link for a board (share.open_link). Always `/b/<id>`. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

export interface SharePanelProps {
  boardId: string;
}

type PanelState = 'closed' | 'open' | 'copied' | 'manual';

export function SharePanel({ boardId }: SharePanelProps): ReactElement {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const link = boardLink(origin, boardId);

  const [state, setState] = useState<PanelState>('closed');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCopyTimer = useCallback(() => {
    if (copyTimer.current !== null) {
      clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
  }, []);

  // Clear any pending "Link copied" timer when the panel unmounts.
  useEffect(() => clearCopyTimer, [clearCopyTimer]);

  const openPanel = useCallback(() => {
    clearCopyTimer();
    setState('open');
  }, [clearCopyTimer]);

  const closePanel = useCallback(() => {
    clearCopyTimer();
    setState('closed');
    // Focus management: focus returns to the Share button on close.
    shareButtonRef.current?.focus();
  }, [clearCopyTimer]);

  // While open, close on Escape and on a pointerdown outside the panel.
  useEffect(() => {
    if (state === 'closed') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      const button = shareButtonRef.current;
      if (panel && panel.contains(event.target as Node)) return;
      if (button && button.contains(event.target as Node)) return;
      closePanel();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [state, closePanel]);

  const selectAndManual = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
    setState('manual');
  }, []);

  const onCopy = useCallback(async () => {
    clearCopyTimer();
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      selectAndManual();
      return;
    }
    try {
      await clipboard.writeText(link);
      setState('copied');
      copyTimer.current = setTimeout(() => {
        copyTimer.current = null;
        // Back to the Open state after LINK_COPIED_MS (the button reverts to
        // "Copy link").
        setState('open');
      }, LINK_COPIED_MS);
    } catch {
      selectAndManual();
    }
  }, [clearCopyTimer, link, selectAndManual]);

  const open = state !== 'closed';

  return (
    <>
      <button
        ref={shareButtonRef}
        type="button"
        data-testid="share-button"
        className="share-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) closePanel();
          else openPanel();
        }}
      >
        Share
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Share board"
          className="share-panel"
          data-testid="share-panel"
        >
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={link}
            aria-label="Board link"
            data-testid="share-link-field"
            onClick={(event) => {
              // Clicking inside the field selects the whole link.
              (event.target as HTMLInputElement).select();
            }}
          />
          <button
            type="button"
            data-testid="copy-link"
            onClick={() => {
              void onCopy();
            }}
          >
            {state === 'copied' ? '\u2713 Link copied' : 'Copy link'}
          </button>
          <p data-testid="share-note">Anyone with this link can view and edit this board.</p>
          {state === 'manual' && (
            <p role="status" data-testid="manual-copy-message">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </>
  );
}
