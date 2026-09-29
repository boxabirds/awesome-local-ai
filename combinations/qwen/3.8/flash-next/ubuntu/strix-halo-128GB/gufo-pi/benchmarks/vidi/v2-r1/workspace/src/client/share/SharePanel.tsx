/**
 * Share panel: Share button, panel with link field, Copy link button.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type PanelState = 'closed' | 'open' | 'copied' | 'manual_copy';

export function SharePanel(props: { boardId: string }): JSX.Element {
  const { boardId } = props;
  const [panelState, setPanelState] = useState<PanelState>('closed');
  const panelRef = useRef<HTMLDivElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const closePanel = useCallback(() => {
    setPanelState('closed');
    if (copiedTimerRef.current !== null) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
    // Return focus to Share button
    shareButtonRef.current?.focus();
  }, []);

  const openPanel = useCallback(() => {
    setPanelState('open');
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard) {
        // Clipboard API missing
        selectInput();
        setPanelState('manual_copy');
        return;
      }
      await navigator.clipboard.writeText(link);
      setPanelState('copied');
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = null;
        setPanelState('open');
      }, LINK_COPIED_MS);
    } catch {
      // Clipboard rejected
      selectInput();
      setPanelState('manual_copy');
    }
  }, [link]);

  const selectInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.select();
      inputRef.current.focus();
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    if (panelState === 'closed') return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePanel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panelState, closePanel]);

  // Close on outside click
  useEffect(() => {
    if (panelState === 'closed') return undefined;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target) &&
          shareButtonRef.current && !shareButtonRef.current.contains(target)) {
        closePanel();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [panelState, closePanel]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  return (
    <div ref={panelRef} style={{ position: 'absolute', top: 12, right: 12, zIndex: 100 }}>
      <button
        ref={shareButtonRef}
        type="button"
        data-testid="share-button"
        onClick={openPanel}
        style={{
          padding: '0.5rem 1rem',
          borderRadius: 6,
          border: '1px solid #d1d5db',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '0.875rem',
        }}
      >
        Share
      </button>
      {panelState !== 'closed' && (
        <div
          role="dialog"
          aria-label="Share board"
          data-testid="share-panel"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            padding: '1rem',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            width: 320,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={link}
            data-testid="share-link"
            onClick={selectInput}
            style={{
              width: '100%',
              padding: '0.5rem',
              borderRadius: 4,
              border: '1px solid #d1d5db',
              fontSize: '0.8rem',
              boxSizing: 'border-box',
              marginBottom: '0.75rem',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              data-testid="copy-link"
              onClick={handleCopy}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: 4,
                border: 'none',
                background: panelState === 'copied' ? '#16a34a' : '#2563eb',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              {panelState === 'copied' ? '\u2713 Link copied' : 'Copy link'}
            </button>
          </div>
          {panelState === 'manual_copy' && (
            <p data-testid="manual-copy-msg" style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.5rem', marginBottom: 0 }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.75rem', marginBottom: 0 }}>
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </div>
  );
}
