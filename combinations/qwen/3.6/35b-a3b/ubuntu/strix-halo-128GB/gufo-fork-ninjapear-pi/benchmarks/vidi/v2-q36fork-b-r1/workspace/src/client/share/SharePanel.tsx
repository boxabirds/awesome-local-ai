/**
 * Share panel — button + dialog with copy link and manual-copy fallback.
 * Story 5 — share a board with others using a link.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { LINK_COPIED_MS } from '@/shared/config';

/** Build the full board URL from origin and id. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

interface SharePanelProps {
  boardId: string;
}

type PanelState = 'closed' | 'open' | 'copied' | 'manual_copy';

export function SharePanel(props: SharePanelProps): ReactNode {
  const [panelOpen, setPanelOpen] = useState(false);
  const [copyState, setCopyState] = useState<PanelState>('closed');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shareBtnRef = useRef<HTMLButtonElement>(null);

  const link = boardLink(typeof window !== 'undefined' ? window.location.origin : '', props.boardId);

  // Close panel on outside click or Escape
  useEffect(() => {
    if (!panelOpen) return;

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') closePanel();
    }
    document.addEventListener('keydown', handleEscape);

    function handleClickOutside(e: PointerEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        shareBtnRef.current && !shareBtnRef.current.contains(e.target as Node)
      ) {
        closePanel();
      }
    }

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('pointerdown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('pointerdown', handleClickOutside);
    };
  }, [panelOpen]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setCopyState('closed');
    // Return focus to Share button
    shareBtnRef.current?.focus();
  }, []);

  const handleInputClick = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).select();
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopyState('copied');
      setTimeout(() => {
        setCopyState('closed');
      }, LINK_COPIED_MS);
    } catch {
      setCopyState('manual_copy');
      // Select the link text in the field
      if (inputRef.current) {
        inputRef.current.select();
        inputRef.current.focus();
      }
    }
  }, [link]);

  if (!panelOpen && copyState === 'closed') {
    return (
      <button
        ref={shareBtnRef}
        onClick={() => { setPanelOpen(true); setCopyState('closed'); }}
        style={{
          position: 'fixed',
          top: '12px',
          right: '12px',
          padding: '8px 16px',
          fontSize: '0.9rem',
          fontWeight: 600,
          border: '1px solid #dee2e6',
          borderRadius: '6px',
          background: '#fff',
          cursor: 'pointer',
          zIndex: 100,
        }}
        aria-label="Share"
      >
        Share
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Share board"
      ref={panelRef}
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        padding: '24px',
        background: '#fff',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        zIndex: 200,
        minWidth: '360px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h3 style={{ margin: '0 0 16px', fontSize: '1.2rem', color: '#343a40' }}>
        Share this board
      </h3>

      <label htmlFor="board-link-input" style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem', color: '#6c757d' }}>
        Board link
      </label>
      <input
        id="board-link-input"
        ref={inputRef}
        type="text"
        readOnly
        value={link}
        onClick={handleInputClick}
        onChange={() => {}}
        style={{
          width: '100%',
          padding: '8px 12px',
          fontSize: '0.9rem',
          border: '1px solid #ced4da',
          borderRadius: '6px',
          background: '#f8f9fa',
          marginBottom: '12px',
          boxSizing: 'border-box',
        }}
        aria-label="Board link"
      />

      <button
        onClick={handleCopy}
        data-testid="copy-link-btn"
        disabled={copyState === 'copied'}
        style={{
          width: '100%',
          padding: '10px',
          fontSize: '0.95rem',
          fontWeight: 600,
          border: 'none',
          borderRadius: '6px',
          background: copyState === 'copied' ? '#28a745' : '#007bff',
          color: '#fff',
          cursor: copyState === 'copied' ? 'default' : 'pointer',
          marginBottom: '8px',
        }}
      >
        {copyState === 'copied' ? '✓ Link copied' : 'Copy link'}
      </button>

      <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: '#adb5bd' }}>
        Anyone with this link can view and edit this board.
      </p>

      {copyState === 'manual_copy' && (
        <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: '#dc3545', background: '#fff3cd', padding: '8px', borderRadius: '4px' }}>
          Press Ctrl+C (Cmd+C on Mac) to copy
        </p>
      )}

      <button
        onClick={closePanel}
        style={{
          width: '100%',
          padding: '8px',
          fontSize: '0.85rem',
          border: '1px solid #dee2e6',
          borderRadius: '6px',
          background: '#fff',
          cursor: 'pointer',
          color: '#6c757d',
        }}
      >
        Close
      </button>
    </div>
  );
}
