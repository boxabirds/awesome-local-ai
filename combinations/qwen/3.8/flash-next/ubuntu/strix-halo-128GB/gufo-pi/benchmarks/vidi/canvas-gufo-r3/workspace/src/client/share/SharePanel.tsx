import React, { useState, useRef, useCallback, useEffect } from 'react';
import { LINK_COPIED_MS } from '@shared/config';
import { boardLink } from './board-link';
export { boardLink };

type PanelState = 'closed' | 'open' | 'copied' | 'manual_copy';

export function SharePanel({ boardId }: { boardId: string }): React.ReactNode {
  const [panelState, setPanelState] = useState<PanelState>('closed');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const closePanel = useCallback(() => {
    if (panelState === 'closed') return;
    if (copiedTimerRef.current !== null) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
    setPanelState('closed');
    // Return focus to Share button
    buttonRef.current?.focus();
  }, [panelState]);

  const openPanel = useCallback(() => {
    setPanelState('open');
  }, []);

  const handleCopy = useCallback(async () => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      // Missing clipboard API → manual copy
      setPanelState('manual_copy');
      inputRef.current?.select();
      inputRef.current?.focus();
      return;
    }
    try {
      await clipboard.writeText(link);
      setPanelState('copied');
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = null;
        setPanelState('open');
      }, LINK_COPIED_MS);
    } catch {
      // Clipboard rejected → manual copy
      setPanelState('manual_copy');
      inputRef.current?.select();
      inputRef.current?.focus();
    }
  }, [link]);

  // Close on Escape and outside click
  useEffect(() => {
    if (panelState === 'closed') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePanel();
      }
    };

    const handlePointerDown = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      closePanel();
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [panelState, closePanel]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleInputClick = useCallback(() => {
    inputRef.current?.select();
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={panelState === 'closed' ? openPanel : closePanel}
        aria-label="Share"
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          padding: '8px 16px',
          fontSize: '0.9rem',
          fontWeight: 600,
          cursor: 'pointer',
          borderRadius: '6px',
          border: '1px solid #ccc',
          background: '#fff',
          zIndex: 1000,
        }}
      >
        Share
      </button>
      {panelState !== 'closed' && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Share board"
          style={{
            position: 'absolute',
            top: '48px',
            right: '12px',
            padding: '16px',
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 999,
            width: '360px',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input
              ref={inputRef}
              readOnly
              value={link}
              onClick={handleInputClick}
              aria-label="Board link"
              style={{
                flex: 1,
                padding: '8px',
                fontSize: '0.85rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
              }}
            />
            <button
              onClick={handleCopy}
              style={{
                padding: '8px 12px',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                borderRadius: '4px',
                border: '1px solid #ccc',
                background: panelState === 'copied' ? '#4caf50' : '#f5f5f5',
                color: panelState === 'copied' ? '#fff' : '#333',
                whiteSpace: 'nowrap',
              }}
            >
              {panelState === 'copied' ? '✓ Link copied' : 'Copy link'}
            </button>
          </div>
          {panelState === 'manual_copy' && (
            <p style={{ fontSize: '0.8rem', color: '#d32f2f', margin: '4px 0' }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p style={{ fontSize: '0.8rem', color: '#777', margin: '4px 0 0 0' }}>
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </>
  );
}
