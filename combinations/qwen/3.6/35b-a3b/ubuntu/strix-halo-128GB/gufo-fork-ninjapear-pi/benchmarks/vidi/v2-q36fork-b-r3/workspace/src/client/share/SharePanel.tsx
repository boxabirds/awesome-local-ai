import React, { useState, useRef, useCallback } from 'react';
import { LINK_COPIED_MS } from '@shared/config';

/** Build the full board link. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type CopyState = 'idle' | 'copied' | 'manual_copy';

export function SharePanel(props: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fullLink = typeof window !== 'undefined'
    ? boardLink(window.location.origin, props.boardId)
    : '';

  const handleCopyClick = useCallback(async () => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(fullLink);
        setCopyState('copied');
        setTimeout(() => {
          setCopyState('idle');
        }, LINK_COPIED_MS);
        return;
      } catch {
        // Fall through to manual copy
      }
    }

    // Manual copy fallback — select the text in the input
    setCopyState('manual_copy');
    if (containerRef.current) {
      const input = containerRef.current.querySelector('input[readonly]') as HTMLInputElement | null;
      if (input) {
        input.select();
        input.focus();
      }
    }
  }, [fullLink]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setCopyState('idle');
    shareButtonRef.current?.focus();
  }, []);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    },
    [handleClose],
  );

  const handleOutsideClick = useCallback(
    (e: MouseEvent) => {
      if (!open) return;
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        handleClose();
      }
    },
    [open, handleClose],
  );

  const handleSelectAll = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    (e.target as HTMLInputElement).select();
  }, []);

  React.useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('pointerdown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('pointerdown', handleOutsideClick);
    };
  }, [open, handleEscape, handleOutsideClick]);

  return (
    <>
      {/* Share button — top-right corner */}
      <button
        ref={shareButtonRef}
        onClick={() => setOpen(true)}
        aria-label="Share"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 1000,
          padding: '8px 16px',
          fontSize: 14,
          fontWeight: 600,
          border: 'none',
          borderRadius: 6,
          background: '#4b5563',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        Share
      </button>

      {/* Share panel overlay */}
      {open && (
        <div
          role="dialog"
          aria-label="Share board"
          ref={containerRef}
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            width: 380,
            maxHeight: 'calc(100vh - 32px)',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
            padding: 24,
            zIndex: 1001,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Share this board</h3>

          {/* Read-only link field — click selects all */}
          <input
            type="text"
            readOnly
            value={fullLink}
            onClick={handleSelectAll}
            aria-label="Board link"
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 13,
              fontFamily: 'monospace',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#f9fafb',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />

          {/* Copy button */}
          <button
            onClick={handleCopyClick}
            aria-label="Copy link"
            style={{
              width: '100%',
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 600,
              border: 'none',
              borderRadius: 6,
              background: '#2563eb',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {copyState === 'copied' ? '✓ Link copied' : 'Copy link'}
          </button>

          {/* Note about access model */}
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>
            Anyone with this link can view and edit this board.
          </p>

          {/* Manual-copy instruction */}
          {copyState === 'manual_copy' && (
            <p style={{ margin: 0, fontSize: 12, color: '#dc2626', fontWeight: 500 }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </>
  );
}
