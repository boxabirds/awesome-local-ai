// src/client/share/SharePanel.tsx
// Share button + panel + copy with manual-copy fallback.

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ReactElement } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type PanelState = 'closed' | 'open' | 'copied' | 'manual_copy';

export function SharePanel(props: { boardId: string }): ReactElement {
  const { boardId } = props;
  const [panelState, setPanelState] = useState<PanelState>('closed');
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  // Close on Escape
  useEffect(() => {
    if (panelState === 'closed') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePanel();
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
        if (shareBtnRef.current && !shareBtnRef.current.contains(e.target as Node)) {
          closePanel();
        }
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [panelState]);

  const closePanel = useCallback(() => {
    setPanelState('closed');
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    // Focus returns to Share button
    shareBtnRef.current?.focus();
  }, []);

  const handleShareClick = useCallback(() => {
    if (panelState === 'closed') {
      setPanelState('open');
    } else {
      closePanel();
    }
  }, [panelState, closePanel]);

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        // Missing API → manual copy
        triggerManualCopy();
        return;
      }
      await navigator.clipboard.writeText(link);
      setPanelState('copied');
      copyTimerRef.current = setTimeout(() => {
        setPanelState('open');
        copyTimerRef.current = null;
      }, LINK_COPIED_MS);
    } catch {
      // Rejected → manual copy
      triggerManualCopy();
    }
  }, [link]);

  const triggerManualCopy = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    setPanelState('manual_copy');
  }, []);

  const handleInputClick = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.select();
    }
  }, []);

  const isOpen = panelState !== 'closed';

  return (
    <div style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 1000 }}>
      <button
        ref={shareBtnRef}
        onClick={handleShareClick}
        aria-label="Share"
        style={{
          padding: '0.5rem 1rem',
          cursor: 'pointer',
          fontSize: '0.9rem',
        }}
      >
        Share
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Share board"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '0.5rem',
            padding: '1rem',
            border: '1px solid #ccc',
            borderRadius: '8px',
            backgroundColor: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            minWidth: '300px',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={link}
            onClick={handleInputClick}
            style={{
              width: '100%',
              padding: '0.5rem',
              marginBottom: '0.5rem',
              fontSize: '0.85rem',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleCopy}
            aria-label="Copy link"
            style={{
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              marginBottom: '0.5rem',
              width: '100%',
            }}
          >
            {panelState === 'copied' ? '✓ Link copied' : 'Copy link'}
          </button>
          <p style={{ fontSize: '0.8rem', color: '#666', margin: 0 }}>
            Anyone with this link can view and edit this board.
          </p>
          {panelState === 'manual_copy' && (
            <p style={{ fontSize: '0.8rem', color: '#c00', marginTop: '0.5rem', marginBottom: 0 }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </div>
  );
}
