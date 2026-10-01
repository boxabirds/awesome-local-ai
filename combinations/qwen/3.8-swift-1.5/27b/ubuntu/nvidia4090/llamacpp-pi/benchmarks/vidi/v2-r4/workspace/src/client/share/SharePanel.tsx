import { useState, useRef, useEffect, useCallback } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type PanelState = 'closed' | 'open' | 'copied' | 'manual_copy';

export function SharePanel({ boardId }: { boardId: string }) {
  const [panelState, setPanelState] = useState<PanelState>('closed');
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const closePanel = useCallback(() => {
    setPanelState('closed');
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    shareBtnRef.current?.focus();
  }, []);

  const handleCopy = useCallback(async () => {
    const input = inputRef.current;
    try {
      if (!navigator.clipboard) {
        throw new Error('clipboard not available');
      }
      await navigator.clipboard.writeText(link);
      setPanelState('copied');
      copyTimerRef.current = setTimeout(() => {
        setPanelState('open');
      }, LINK_COPIED_MS);
    } catch {
      // Manual copy fallback
      if (input) {
        input.focus();
        input.select();
      }
      setPanelState('manual_copy');
    }
  }, [link]);

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
  }, [panelState, closePanel]);

  // Close on outside click
  useEffect(() => {
    if (panelState === 'closed') return;
    const handler = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if (shareBtnRef.current && !shareBtnRef.current.contains(e.target as Node)) {
          closePanel();
        }
      }
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [panelState, closePanel]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Select all text when clicking the input
  const handleInputClick = useCallback(() => {
    inputRef.current?.select();
  }, []);

  return (
    <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 1000 }}>
      <button
        ref={shareBtnRef}
        onClick={() => setPanelState('open')}
        style={{
          padding: '0.5rem 1rem',
          fontSize: '0.9rem',
          cursor: 'pointer',
        }}
        aria-label="Share"
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
            top: '100%',
            right: 0,
            marginTop: '0.5rem',
            padding: '1rem',
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: '8px',
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
              border: '1px solid #ccc',
              borderRadius: '4px',
              fontSize: '0.85rem',
            }}
            aria-label="Board link"
          />
          <button
            onClick={handleCopy}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.9rem',
              cursor: 'pointer',
              width: '100%',
              marginBottom: '0.5rem',
            }}
          >
            {panelState === 'copied' ? '✓ Link copied' : 'Copy link'}
          </button>
          {panelState === 'manual_copy' && (
            <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p style={{ fontSize: '0.75rem', color: '#888' }}>
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </div>
  );
}
