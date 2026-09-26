import { useState, useRef, useEffect, useCallback, type JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** Build the full link for a board. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type ShareState = 'closed' | 'open' | 'copied' | 'manual_copy';

export function SharePanel({ boardId }: { boardId: string }): JSX.Element {
  const [state, setState] = useState<ShareState>('closed');
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const close = useCallback(() => {
    setState('closed');
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Return focus to the share button
    buttonRef.current?.focus();
  }, []);

  const open = useCallback(() => {
    setState('open');
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(link);
      setState('copied');
      timerRef.current = setTimeout(() => {
        setState('open');
      }, LINK_COPIED_MS);
    } catch {
      // Fallback: select the text in the input
      setState('manual_copy');
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }
  }, [link]);

  // Close on Escape
  useEffect(() => {
    if (state === 'closed') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, close]);

  // Close on outside pointerdown
  useEffect(() => {
    if (state === 'closed') return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [state, close]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <div className="share-wrapper">
      <button
        ref={buttonRef}
        className="share-button"
        onClick={state === 'closed' ? open : close}
        aria-label="Share"
      >
        Share
      </button>
      {state !== 'closed' && (
        <div
          ref={panelRef}
          className="share-panel"
          role="dialog"
          aria-label="Share board"
        >
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={link}
            className="share-link-field"
            onClick={(e) => (e.target as HTMLInputElement).select()}
            aria-label="Board link"
          />
          <button
            onClick={handleCopy}
            className="share-copy-button"
          >
            {state === 'copied' ? '✓ Link copied' : 'Copy link'}
          </button>
          <p className="share-note">
            Anyone with this link can view and edit this board.
          </p>
          {state === 'manual_copy' && (
            <p className="share-manual">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </div>
  );
}
