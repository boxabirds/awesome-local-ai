import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type PanelState = 'closed' | 'open' | 'copied' | 'manual_copy';

export function SharePanel(props: { boardId: string }): React.JSX.Element {
  const { boardId } = props;
  const [panelState, setPanelState] = useState<PanelState>('closed');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const closePanel = useCallback(() => {
    setPanelState('closed');
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
    // Return focus to Share button
    shareBtnRef.current?.focus();
  }, []);

  const openPanel = useCallback(() => {
    setPanelState('open');
  }, []);

  // Close on Escape and outside pointerdown
  useEffect(() => {
    if (panelState === 'closed') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePanel();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          shareBtnRef.current && !shareBtnRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [panelState, closePanel]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
    };
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
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleInputClick = useCallback(() => {
    inputRef.current?.select();
  }, []);

  const copyButtonText = panelState === 'copied' ? '✓ Link copied' : 'Copy link';

  return (
    <>
      <button
        ref={shareBtnRef}
        onClick={openPanel}
        aria-label="Share"
        style={{
          position: 'fixed',
          top: '12px',
          right: '12px',
          padding: '8px 16px',
          fontSize: '14px',
          cursor: 'pointer',
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
            position: 'fixed',
            top: '48px',
            right: '12px',
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 1001,
            minWidth: '320px',
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
                padding: '6px 8px',
                fontSize: '13px',
                border: '1px solid #ccc',
                borderRadius: '4px',
              }}
            />
            <button
              onClick={handleCopy}
              aria-label="Copy link"
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {copyButtonText}
            </button>
          </div>
          {panelState === 'manual_copy' && (
            <p style={{ fontSize: '12px', color: '#666', margin: '4px 0' }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 0 0' }}>
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </>
  );
}
