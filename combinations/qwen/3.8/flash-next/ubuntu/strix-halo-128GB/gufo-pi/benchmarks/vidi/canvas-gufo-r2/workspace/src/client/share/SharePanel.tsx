/**
 * Share panel: Share button, panel with link field and Copy link button.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/**
 * Generate the full board link from origin and board id.
 */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type PanelState = 'closed' | 'open' | 'copied' | 'manual_copy';

export function SharePanel(props: { boardId: string }) {
  const [panelState, setPanelState] = useState<PanelState>('closed');
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, props.boardId);

  const closePanel = useCallback(() => {
    setPanelState('closed');
    if (copiedTimer.current) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
    // Return focus to Share button
    buttonRef.current?.focus();
  }, []);

  const openPanel = useCallback(() => {
    setPanelState('open');
  }, []);

  // Click outside handler
  useEffect(() => {
    if (panelState === 'closed') return;

    const onPointerDown = (e: PointerEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        closePanel();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [panelState, closePanel]);

  // Escape key handler
  useEffect(() => {
    if (panelState === 'closed') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePanel();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [panelState, closePanel]);

  const handleCopy = useCallback(async () => {
    // Reset copied timer if running
    if (copiedTimer.current) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(link);
        setPanelState('copied');
        copiedTimer.current = setTimeout(() => {
          setPanelState('open');
          copiedTimer.current = null;
        }, LINK_COPIED_MS);
        return;
      } catch {
        // Clipboard rejected → manual copy
        doManualCopy();
        return;
      }
    }

    // Clipboard API missing → manual copy
    doManualCopy();
  }, [link]);

  const doManualCopy = () => {
    setPanelState('manual_copy');
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  };

  const handleInputClick = useCallback(() => {
    inputRef.current?.select();
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimer.current) {
        clearTimeout(copiedTimer.current);
      }
    };
  }, []);

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
      {panelState !== 'closed' && (
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
            {panelState === 'copied' ? '✓ Link copied' : 'Copy link'}
          </button>
          <p className="share-note">Anyone with this link can view and edit this board.</p>
          {panelState === 'manual_copy' && (
            <p className="manual-copy-message">Press Ctrl+C (Cmd+C on Mac) to copy</p>
          )}
        </div>
      )}
    </>
  );
}
