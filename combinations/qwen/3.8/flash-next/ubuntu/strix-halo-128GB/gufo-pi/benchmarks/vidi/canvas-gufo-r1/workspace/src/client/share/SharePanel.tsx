import { useState, useRef, useEffect, useCallback } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type ShareState = 'closed' | 'open' | 'copied' | 'manual_copy';

export function SharePanel({ boardId }: { boardId: string }) {
  const [state, setState] = useState<ShareState>('closed');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const closePanel = useCallback(() => {
    setState('closed');
    if (timerRef.current) clearTimeout(timerRef.current);
    buttonRef.current?.focus();
  }, []);

  const openPanel = useCallback(() => {
    setState('open');
  }, []);

  useEffect(() => {
    if (state === 'closed') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
        closePanel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [state, closePanel]);

  useEffect(() => {
    if (state === 'copied') {
      timerRef.current = setTimeout(() => {
        setState('open');
      }, LINK_COPIED_MS);
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }
  }, [state]);

  const selectInput = () => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  };

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard) {
        selectInput();
        setState('manual_copy');
        return;
      }
      await navigator.clipboard.writeText(link);
      setState('copied');
    } catch {
      selectInput();
      setState('manual_copy');
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        data-testid="share-btn"
        className="share-button"
        onClick={openPanel}
      >
        Share
      </button>
      {state !== 'closed' && (
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
            data-testid="share-link-input"
            onClick={() => inputRef.current?.select()}
          />
          <button data-testid="copy-link-btn" onClick={handleCopy}>
            {state === 'copied' ? '✓ Link copied' : 'Copy link'}
          </button>
          <p className="share-note">Anyone with this link can view and edit this board.</p>
          {state === 'manual_copy' && (
            <p data-testid="manual-copy-msg">Press Ctrl+C (Cmd+C on Mac) to copy</p>
          )}
        </div>
      )}
    </>
  );
}
