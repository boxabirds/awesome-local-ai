/**
 * Share panel: Share button + panel with copy link and manual-copy fallback.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type PanelState = 'closed' | 'open' | 'copied' | 'manual_copy';

export function SharePanel(props: { boardId: string }): JSX.Element {
  const { boardId } = props;
  const [panelState, setPanelState] = useState<PanelState>('closed');
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    if (panelState === 'closed') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanelState('closed');
        shareButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [panelState]);

  // Close on outside pointerdown
  useEffect(() => {
    if (panelState === 'closed') return;
    const handler = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if (shareButtonRef.current && !shareButtonRef.current.contains(e.target as Node)) {
          setPanelState('closed');
          shareButtonRef.current?.focus();
        }
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [panelState]);

  // Focus input when panel opens
  useEffect(() => {
    if (panelState === 'open' || panelState === 'manual_copy') {
      inputRef.current?.focus();
    }
  }, [panelState]);

  const handleShareClick = useCallback(() => {
    if (panelState === 'closed') {
      setPanelState('open');
    } else {
      setPanelState('closed');
      shareButtonRef.current?.focus();
    }
  }, [panelState]);

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard) {
        // Clipboard API missing → manual copy
        inputRef.current?.select();
        inputRef.current?.focus();
        setPanelState('manual_copy');
        return;
      }
      await navigator.clipboard.writeText(link);
      setPanelState('copied');
      copiedTimerRef.current = setTimeout(() => {
        setPanelState('open');
      }, LINK_COPIED_MS);
    } catch {
      // writeText rejected → manual copy
      inputRef.current?.select();
      inputRef.current?.focus();
      setPanelState('manual_copy');
    }
  }, [link]);

  const handleInputClick = useCallback(() => {
    inputRef.current?.select();
  }, []);

  const isOpen = panelState !== 'closed';

  return (
    <div className="share-panel-wrapper" data-vidi6="share-wrapper">
      <button
        ref={shareButtonRef}
        data-vidi6="share-button"
        onClick={handleShareClick}
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
          data-vidi6="share-panel"
        >
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={link}
            data-vidi6="share-link-input"
            onClick={handleInputClick}
          />
          <button
            data-vidi6="copy-link-button"
            onClick={handleCopy}
          >
            {panelState === 'copied' ? '✓ Link copied' : 'Copy link'}
          </button>
          {panelState === 'manual_copy' && (
            <p data-vidi6="manual-copy-message">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p data-vidi6="share-note">
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </div>
  );
}
