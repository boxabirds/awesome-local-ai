// Share panel: Share button, panel with link field, Copy link button.
// States: Closed → Open → Copied / ManualCopy → Closed.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type ShareState = 'closed' | 'open' | 'copied' | 'manual-copy';

export function SharePanel({ boardId }: { boardId: string }) {
  const [state, setState] = useState<ShareState>('closed');
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Close on Escape.
  useEffect(() => {
    if (state === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  // Close on outside pointerdown.
  useEffect(() => {
    if (state === 'closed') return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        if (shareBtnRef.current && !shareBtnRef.current.contains(target)) {
          close();
        }
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [state]);

  const close = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setState('closed');
    // Focus returns to Share button on close (deferred to avoid conflict
    // with the click event's default focus behaviour).
    setTimeout(() => shareBtnRef.current?.focus(), 0);
  }, []);

  const handleShareClick = useCallback(() => {
    if (state === 'closed') {
      setState('open');
    } else {
      close();
    }
  }, [state, close]);

  const handleCopy = useCallback(async () => {
    const doManualCopy = () => {
      // Select the full link in the field and show the message.
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
      setState('manual-copy');
    };

    try {
      if (!navigator.clipboard) {
        doManualCopy();
        return;
      }
      await navigator.clipboard.writeText(link);
      setState('copied');
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setState('open');
      }, LINK_COPIED_MS);
    } catch {
      doManualCopy();
    }
  }, [link]);

  const handleInputClick = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      input.select();
    }
  }, []);

  const isOpen = state !== 'closed';

  return (
    <div className="share-panel-wrapper" data-testid="share-panel-wrapper">
      <button
        ref={shareBtnRef}
        onClick={handleShareClick}
        className="share-button"
        data-testid="share-button"
        aria-label="Share"
      >
        Share
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          className="share-panel"
          role="dialog"
          aria-label="Share board"
          data-testid="share-dialog"
        >
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={link}
            onClick={handleInputClick}
            className="share-panel__link"
            data-testid="share-link-input"
          />
          <button
            onClick={handleCopy}
            className="share-panel__copy-btn"
            data-testid="copy-link-button"
          >
            {state === 'copied' ? 'Link copied ✓' : 'Copy link'}
          </button>
          {state === 'manual-copy' && (
            <p className="share-panel__manual" data-testid="manual-copy-message">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p className="share-panel__note" data-testid="share-note">
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </div>
  );
}
