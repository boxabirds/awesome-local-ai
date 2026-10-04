/**
 * Share panel (story 5, share.copy): the Share button (top right) and the
 * dialog with the board link, Copy link (with a manual-copy fallback when
 * the clipboard is unavailable or blocked) and the security-model note.
 *
 * Behaviour:
 * - Opens on Share; closes on Escape or a pointerdown outside the panel;
 *   focus returns to the Share button on close.
 * - The link input is read-only and its full text is selected on open and
 *   on focus, so Ctrl+C/Cmd+C always copies the complete link.
 * - Copy link writes the full link to the clipboard and shows "Link
 *   copied" (with a tick) for LINK_COPIED_MS; if the clipboard write
 *   rejects, the manual-copy message appears and the link stays selected.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The shareable link for a board (PRD share.copy: `https://<host>/b/<id>`). */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

const NOTE_TEXT = 'Anyone with this link can view and edit this board.';
const MANUAL_COPY_TEXT = 'Press Ctrl+C (Cmd+C on Mac) to copy';

export function SharePanel(props: { boardId: string }): JSX.Element {
  const { boardId } = props;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const link = boardLink(window.location.origin, boardId);

  const close = () => {
    setOpen(false);
    setCopied(false);
    setManualCopy(false);
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
    buttonRef.current?.focus();
  };

  // Escape and outside-pointerdown close the panel while it is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // Clean up the "Link copied" timer on unmount.
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  // Select the full link when the panel opens and whenever the input gains
  // focus (story 5: manual copy always copies the complete link).
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  const manualCopyFallback = () => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
    setManualCopy(true);
  };

  const onCopy = () => {
    setManualCopy(false);
    const write = navigator.clipboard?.writeText?.(link);
    if (!write) {
      manualCopyFallback();
      return;
    }
    void write.then(
      () => {
        setCopied(true);
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = setTimeout(() => setCopied(false), LINK_COPIED_MS);
      },
      () => manualCopyFallback(),
    );
  };

  return (
    <div
      ref={containerRef}
      data-testid="share-container"
      style={{ position: 'fixed', top: 12, right: 12, zIndex: 1002 }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-testid="share-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        style={{
          fontSize: 14,
          fontWeight: 600,
          padding: '6px 14px',
          borderRadius: 8,
          border: '1px solid #dadce0',
          background: '#fff',
          color: '#1f1f1f',
          cursor: 'pointer',
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        }}
      >
        Share
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Share board"
          data-testid="share-panel"
          style={{
            position: 'absolute',
            top: 44,
            right: 0,
            width: 320,
            padding: 16,
            borderRadius: 12,
            border: '1px solid #dadce0',
            background: '#fff',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <input
            ref={inputRef}
            readOnly
            value={link}
            data-testid="share-link-input"
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
            style={{
              fontSize: 13,
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid #dadce0',
              background: '#f8f9fa',
              color: '#1f1f1f',
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
          <button
            type="button"
            data-testid="copy-link-btn"
            onClick={onCopy}
            style={{
              fontSize: 14,
              fontWeight: 600,
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: copied ? '#34a853' : '#2563eb',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {copied ? '✓ Link copied' : 'Copy link'}
          </button>
          {manualCopy && (
            <p role="alert" data-testid="manual-copy" style={{ fontSize: 13, color: '#b06000', margin: 0 }}>
              {MANUAL_COPY_TEXT}
            </p>
          )}
          <p data-testid="share-note" style={{ fontSize: 13, color: '#5f6368', margin: 0 }}>
            {NOTE_TEXT}
          </p>
        </div>
      )}
    </div>
  );
}
