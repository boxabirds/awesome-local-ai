import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/**
 * Story 5: share panel (share.copy).
 * Share button (top-right) → panel with the full board link; "Copy link"
 * copies to the clipboard and shows "Link copied" for LINK_COPIED_MS. When
 * the clipboard is blocked, the input is fully selected and a manual-copy
 * hint is shown. Escape and outside clicks close the panel and return
 * focus to the Share button.
 */

export function boardLink(origin: string, boardId: string): string {
  return `${origin}/b/${boardId}`;
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 8,
  width: 320,
  padding: 16,
  borderRadius: 8,
  border: '1px solid #ddd',
  background: '#fff',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
  fontFamily: 'system-ui, sans-serif',
  zIndex: 50,
};

export function SharePanel(props: { boardId: string }) {
  const { boardId } = props;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    setManualCopy(false);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    shareButtonRef.current?.focus();
  }, []);

  // Escape closes the panel
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, close]);

  // Outside pointerdown closes the panel
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current && panelRef.current.contains(target)) return;
      if (shareButtonRef.current && shareButtonRef.current.contains(target)) return;
      close();
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open, close]);

  const copy = useCallback(async () => {
    setManualCopy(false);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        timerRef.current = setTimeout(() => setCopied(false), LINK_COPIED_MS);
        return;
      } catch {
        // Fall through to manual copy
      }
    }
    // Manual copy: fully select the link and show the hint
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
    setManualCopy(true);
  }, [link]);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={shareButtonRef}
        data-testid="share-button"
        onClick={() => {
          setCopied(false);
          setManualCopy(false);
          setOpen(true);
        }}
        style={{
          padding: '8px 16px',
          borderRadius: 6,
          border: '1px solid #ccc',
          background: '#fff',
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        Share
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Share board"
          data-testid="share-panel"
          style={panelStyle}
        >
          <input
            ref={inputRef}
            readOnly
            value={link}
            data-testid="share-link-input"
            onFocus={() => inputRef.current?.select()}
            style={{
              width: '100%',
              padding: 8,
              fontSize: 13,
              boxSizing: 'border-box',
              marginBottom: 8,
            }}
          />
          <button
            data-testid="copy-link-button"
            onClick={copy}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: copied ? '#e8f5e9' : '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {copied ? 'Link copied ✓' : 'Copy link'}
          </button>
          {manualCopy && (
            <p data-testid="manual-copy-message" style={{ fontSize: 13, marginTop: 8, color: '#555' }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p style={{ fontSize: 12, marginTop: 8, color: '#777' }}>
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </div>
  );
}
