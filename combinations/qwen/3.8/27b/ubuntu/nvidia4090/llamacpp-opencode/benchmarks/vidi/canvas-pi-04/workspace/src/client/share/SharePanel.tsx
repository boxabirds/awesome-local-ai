// Story 5: share panel (share.share_panel): the Share button (top-right), a
// dialog with the board link, Copy link, and the manual-copy fallback when
// the clipboard API is missing or blocked. State: Closed -> Open -> Copied
// (writeText resolves; reverts after LINK_COPIED_MS) | ManualCopy (writeText
// rejects or is unavailable). Escape or an outside pointerdown closes the
// panel and returns focus to the Share button.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The shareable link for a board (share.share_panel). */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type PanelState = 'open' | 'copied' | 'manual';

export function SharePanel(props: { boardId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>('open');
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<number | null>(null);

  const link = boardLink(window.location.origin, props.boardId);

  const clearCopyTimer = useCallback((): void => {
    if (copyTimer.current !== null) {
      window.clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
  }, []);

  const close = useCallback((): void => {
    setOpen(false);
    setState('open');
    clearCopyTimer();
    // Focus returns to the Share button (share.share_panel).
    shareButtonRef.current?.focus();
  }, [clearCopyTimer]);

  // Close on Escape or an outside pointerdown while open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: PointerEvent): void => {
      const panel = panelRef.current;
      if (panel !== null && e.target instanceof Node && !panel.contains(e.target)) {
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  // On unmount, drop the "copied" revert timer.
  useEffect(() => () => clearCopyTimer(), [clearCopyTimer]);

  const selectInput = useCallback((): void => {
    const input = inputRef.current;
    if (input !== null) {
      input.focus();
      input.select();
    }
  }, []);

  const copy = useCallback((): void => {
    const clipboard = navigator.clipboard;
    const manual = (): void => {
      selectInput();
      setState('manual');
    };
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      // Clipboard API missing (insecure context, old browser): manual copy.
      manual();
      return;
    }
    void clipboard.writeText(link).then(
      () => {
        clearCopyTimer();
        setState('copied');
        copyTimer.current = window.setTimeout(() => {
          copyTimer.current = null;
          setState('open');
        }, LINK_COPIED_MS);
      },
      () => {
        // Rejected (permission denied, etc.): manual copy.
        manual();
      },
    );
  }, [link, clearCopyTimer, selectInput]);

  return (
    <>
      <button
        ref={shareButtonRef}
        type="button"
        className="share-toggle"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Share
      </button>
      {open && (
        <div ref={panelRef} className="share-panel" role="dialog" aria-label="Share board">
          <input
            ref={inputRef}
            className="share-input"
            type="text"
            readOnly
            value={link}
            aria-label="Board link"
            onClick={(e) => e.currentTarget.select()}
          />
          <button type="button" className="btn btn--primary share-copy" onClick={copy}>
            {state === 'copied' ? '✓ Link copied' : 'Copy link'}
          </button>
          {state === 'manual' && (
            <p className="share-manual">Press Ctrl+C (Cmd+C on Mac) to copy</p>
          )}
          <p className="share-note">Anyone with this link can view and edit this board.</p>
        </div>
      )}
    </>
  );
}
