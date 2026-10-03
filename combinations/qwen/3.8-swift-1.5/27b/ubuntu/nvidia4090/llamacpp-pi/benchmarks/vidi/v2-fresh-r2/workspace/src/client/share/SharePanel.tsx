/**
 * Share panel (story 5, share.share_panel).
 *
 * A Share button (top-right) opens a small dialog with the board's full
 * link in a read-only field, a Copy link button and the access-model note.
 *
 * Copy states:
 * - writeText resolves → button reads "Link copied" for LINK_COPIED_MS
 * - navigator.clipboard missing or writeText rejects → ManualCopy: the
 *   whole link is selected in the field and "Press Ctrl+C (Cmd+C on Mac)
 *   to copy" is shown
 *
 * The panel closes on Escape or an outside pointerdown; focus returns to
 * the Share button.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The board's shareable link for a given origin. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

export function SharePanel(props: { boardId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<number | undefined>(undefined);

  const link = boardLink(window.location.origin, props.boardId);

  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    setManual(false);
    if (copiedTimerRef.current !== undefined) {
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = undefined;
    }
    buttonRef.current?.focus();
  }, []);

  // Close on Escape and on pointerdown outside the panel/button.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== undefined) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const selectAllInField = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const handleCopy = useCallback(async () => {
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      try {
        await clipboard.writeText(link);
        setManual(false);
        setCopied(true);
        if (copiedTimerRef.current !== undefined) {
          window.clearTimeout(copiedTimerRef.current);
        }
        copiedTimerRef.current = window.setTimeout(() => {
          copiedTimerRef.current = undefined;
          setCopied(false);
        }, LINK_COPIED_MS);
        return;
      } catch {
        // fall through to the manual-copy path
      }
    }
    // Clipboard unavailable or blocked: select the full link for a manual
    // Ctrl+C (Cmd+C on Mac) copy.
    selectAllInField();
    setCopied(false);
    setManual(true);
  }, [link]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
      }}
    >
      <button
        ref={buttonRef}
        data-testid="share-btn"
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: '8px 16px',
          fontSize: 14,
          borderRadius: 8,
          border: '1px solid #ddd',
          backgroundColor: 'white',
          cursor: 'pointer',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
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
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 12,
            backgroundColor: 'white',
            borderRadius: 10,
            border: '1px solid #ddd',
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
            width: 340,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <input
            ref={inputRef}
            aria-label="Board link"
            readOnly
            value={link}
            onClick={selectAllInField}
            style={{
              padding: '8px 10px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid #ddd',
              backgroundColor: '#f8f8f8',
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
          <button
            data-testid="copy-link-btn"
            onClick={() => {
              void handleCopy();
            }}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              borderRadius: 6,
              border: 'none',
              backgroundColor: copied ? '#1e8e3e' : '#1a73e8',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            {copied ? 'Link copied ✓' : 'Copy link'}
          </button>
          <p style={{ margin: 0, fontSize: 12, color: '#555' }}>
            Anyone with this link can view and edit this board.
          </p>
          {manual && (
            <p style={{ margin: 0, fontSize: 12, color: '#d93025' }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </div>
  );
}
