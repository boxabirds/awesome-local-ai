import { useState, useRef, useCallback, useEffect } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** Build the full board link from origin and id. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

export interface SharePanelProps {
  boardId: string;
}

type PanelState = 'closed' | 'open' | 'copied' | 'manual_copy';

/**
 * Share button + panel: copy link with manual-copy fallback.
 */
export function SharePanel({ boardId }: SharePanelProps) {
  const [panelState, setPanelState] = useState<PanelState>('closed');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  // Close panel on outside pointerdown
  useEffect(() => {
    if (panelState === 'closed') return;
    const handler = (e: PointerEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        closePanel();
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [panelState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close panel on Escape
  useEffect(() => {
    if (panelState === 'closed') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePanel();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [panelState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup copied timer
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const closePanel = () => {
    if (copiedTimerRef.current !== null) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
    setPanelState('closed');
    // Return focus to Share button
    buttonRef.current?.focus();
  };

  const openPanel = () => {
    setPanelState('open');
  };

  const handleCopy = useCallback(async () => {
    if (!navigator.clipboard) {
      // Clipboard API not available
      setPanelState('manual_copy');
      if (inputRef.current) {
        inputRef.current.select();
        inputRef.current.focus();
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      setPanelState('copied');
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = null;
        setPanelState('open');
      }, LINK_COPIED_MS);
    } catch {
      // writeText rejected (permission denied, insecure context)
      setPanelState('manual_copy');
      if (inputRef.current) {
        inputRef.current.select();
        inputRef.current.focus();
      }
    }
  }, [link]);

  const handleInputClick = () => {
    inputRef.current?.select();
  };

  if (panelState === 'closed') {
    return (
      <button
        ref={buttonRef}
        className="share-button"
        onClick={openPanel}
        aria-label="Share"
      >
        Share
      </button>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        className="share-button"
        onClick={openPanel}
        aria-label="Share"
      >
        Share
      </button>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Share board"
        className="share-panel"
      >
        <input
          ref={inputRef}
          type="text"
          readOnly
          value={link}
          onClick={handleInputClick}
          aria-label="Board link"
        />
        <button onClick={handleCopy}>
          {panelState === 'copied' ? '\u2713 Link copied' : 'Copy link'}
        </button>
        <p className="share-note">Anyone with this link can view and edit this board.</p>
        {panelState === 'manual_copy' && (
          <p className="share-manual" role="status">Press Ctrl+C (Cmd+C on Mac) to copy</p>
        )}
      </div>
    </>
  );
}
