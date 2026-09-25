/**
 * Share panel (story 5, share.share_panel).
 *
 * A button in the top-right corner that opens a small dialog showing the
 * board's link. Clicking "Copy link" copies the full URL to the clipboard.
 * If the clipboard is blocked or unavailable, the link text is selected and
 * a manual-copy instruction is shown.
 *
 * States: Closed → Open → (Copied | ManualCopy) → Closed
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** Build the full board link from origin and id. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type PanelState = 'open' | 'copied' | 'manual';

export function SharePanel({ boardId }: { boardId: string }) {
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<PanelState>('open');
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  // Close on Escape.
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible]);

  // Close on outside pointerdown.
  useEffect(() => {
    if (!visible) return;
    const handler = (e: PointerEvent) => {
      const panel = panelRef.current;
      const btn = shareBtnRef.current;
      if (panel && !panel.contains(e.target as Node) && btn && !btn.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [visible]);

  // Clean up copied timer on unmount.
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setState('open');
    if (copiedTimerRef.current !== null) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
    // Focus returns to the Share button.
    shareBtnRef.current?.focus();
  }, []);

  const open = useCallback(() => {
    setVisible(true);
    setState('open');
  }, []);

  const handleInputClick = useCallback(() => {
    inputRef.current?.select();
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        setState('copied');
        copiedTimerRef.current = setTimeout(() => {
          setState('open');
          copiedTimerRef.current = null;
        }, LINK_COPIED_MS);
      } else {
        // Clipboard API missing → manual copy.
        doManualCopy();
      }
    } catch {
      // writeText rejected → manual copy.
      doManualCopy();
    }
  }, [link]);

  const doManualCopy = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
    setState('manual');
  }, []);

  const isCopied = state === 'copied';
  const isManual = state === 'manual';

  return (
    <>
      <button
        ref={shareBtnRef}
        className="vidi6-share-btn"
        onClick={open}
        aria-label="Share"
        data-testid="share-button"
      >
        Share
      </button>
      {visible && (
        <div
          ref={panelRef}
          className="vidi6-share-panel"
          role="dialog"
          aria-label="Share board"
          data-testid="share-panel"
        >
          <input
            ref={inputRef}
            className="vidi6-share-panel__link"
            type="text"
            readOnly
            value={link}
            onClick={handleInputClick}
            aria-label="Board link"
            data-testid="share-link-input"
          />
          <button
            className="vidi6-share-panel__copy"
            onClick={handleCopy}
            aria-label="Copy link"
            data-testid="copy-link-button"
          >
            {isCopied ? 'Link copied ✓' : 'Copy link'}
          </button>
          {isManual && (
            <p className="vidi6-share-panel__manual" data-testid="manual-copy-message">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p className="vidi6-share-panel__note" data-testid="share-note">
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </>
  );
}
