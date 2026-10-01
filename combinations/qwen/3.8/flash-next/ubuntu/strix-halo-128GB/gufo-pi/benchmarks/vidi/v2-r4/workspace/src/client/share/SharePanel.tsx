import { useState, useRef, useCallback, useEffect } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type ShareState = 'closed' | 'open' | 'copied' | 'manual_copy';

/**
 * Share panel: Share button (top-right), panel with read-only link field,
 * Copy link button, and note.
 */
export function SharePanel(props: { boardId: string }): React.JSX.Element {
  const [state, setState] = useState<ShareState>('closed');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, props.boardId);

  const open = useCallback(() => {
    setState('open');
  }, []);

  const close = useCallback(() => {
    setState('closed');
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // Return focus to Share button
    shareButtonRef.current?.focus();
  }, []);

  // Close on Escape and outside click
  useEffect(() => {
    if (state === 'closed') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        shareButtonRef.current && !shareButtonRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [state, close]);

  // Copy state revert timer
  useEffect(() => {
    if (state === 'copied') {
      timerRef.current = setTimeout(() => {
        setState('open');
        timerRef.current = null;
      }, LINK_COPIED_MS);
    }
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state]);

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard) {
        // Clipboard API missing
        const input = inputRef.current;
        if (input) {
          input.focus();
          input.select();
        }
        setState('manual_copy');
        return;
      }
      await navigator.clipboard.writeText(link);
      setState('copied');
    } catch {
      // Clipboard write rejected
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
      setState('manual_copy');
    }
  }, [link]);

  const handleInputClick = useCallback(() => {
    inputRef.current?.select();
  }, []);

  return (
    <>
      <button
        ref={shareButtonRef}
        className="share-button"
        onClick={open}
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
            onClick={handleInputClick}
            aria-label="Board link"
          />
          <button onClick={handleCopy} aria-label="Copy link">
            {state === 'copied' ? '✓ Link copied' : 'Copy link'}
          </button>
          <p className="share-note">Anyone with this link can view and edit this board.</p>
          {state === 'manual_copy' && (
            <p className="share-manual">Press Ctrl+C (Cmd+C on Mac) to copy</p>
          )}
        </div>
      )}
    </>
  );
}
