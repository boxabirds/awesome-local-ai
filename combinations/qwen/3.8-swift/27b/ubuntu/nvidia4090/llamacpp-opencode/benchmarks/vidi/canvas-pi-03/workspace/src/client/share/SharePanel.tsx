/**
 * Story 5: Share panel (share.share_panel).
 *
 * A Share button in the top-right of the board opens a small panel with the
 * board's full link in a read-only field and a Copy link button.
 *
 * State machine (not persisted):
 *   Closed → Open            click Share
 *   Open → Copied            writeText resolves → "Link copied" for LINK_COPIED_MS
 *   Open → ManualCopy        writeText rejects / API missing → field selected
 *                            + "Press Ctrl+C (Cmd+C on Mac) to copy"
 *   Copied → Open            LINK_COPIED_MS elapsed
 *   Open/Copied/ManualCopy → Closed   Escape or outside pointerdown
 *
 * Focus management: the Share button opens the panel; closing returns focus
 * to it. Clicking the link field selects the whole link.
 */
import { type JSX, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from 'src/shared/config';

/** The board link: the full address, ready to paste (share.copy). */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

const COPY_NOTE = 'Anyone with this link can view and edit this board.';
const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

export function SharePanel(props: { boardId: string }): JSX.Element {
  const { boardId } = props;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<number | null>(null);
  const [origin] = useState(() => window.location.origin);
  const link = boardLink(origin, boardId);

  const clearCopiedTimer = () => {
    if (copiedTimer.current !== null) {
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
  };

  const close = () => {
    setOpen(false);
    setCopied(false);
    setManualCopy(false);
    clearCopiedTimer();
    shareButtonRef.current?.focus();
  };

  // Escape closes the panel (share.share_panel close behaviour).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A pointerdown outside the panel (and the Share button) closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (shareButtonRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Clean up the "Link copied" timer on unmount.
  useEffect(() => clearCopiedTimer, []);

  const selectLink = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  };

  const manualCopyPath = () => {
    setManualCopy(true);
    selectLink();
  };

  const copyLink = () => {
    clearCopiedTimer();
    // navigator.clipboard is missing in insecure contexts and some browsers:
    // fall back to selecting the field for a manual copy (share.copy_fallback).
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      manualCopyPath();
      return;
    }
    clipboard
      .writeText(link)
      .then(() => {
        setManualCopy(false);
        setCopied(true);
        copiedTimer.current = window.setTimeout(() => setCopied(false), LINK_COPIED_MS);
      })
      .catch(() => manualCopyPath());
  };

  return (
    <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 1000 }}>
      <button
        ref={shareButtonRef}
        data-testid="share-button"
        onClick={() => {
          if (open) {
            close();
          } else {
            setOpen(true);
            setCopied(false);
            setManualCopy(false);
          }
        }}
        style={{
          padding: '8px 16px',
          fontSize: 14,
          fontWeight: 600,
          border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: 8,
          background: 'rgba(17, 24, 39, 0.85)',
          color: '#F9FAFB',
          cursor: 'pointer',
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
            marginTop: 8,
            width: 340,
            padding: 16,
            borderRadius: 10,
            background: '#1F2937',
            color: '#F9FAFB',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <input
            ref={inputRef}
            data-testid="share-link-field"
            readOnly
            value={link}
            onClick={selectLink}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid #4B5563',
              background: '#111827',
              color: '#D1D5DB',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <button
              data-testid="copy-link-button"
              onClick={copyLink}
              style={{
                padding: '8px 14px',
                fontSize: 14,
                fontWeight: 600,
                border: 'none',
                borderRadius: 6,
                background: '#34D399',
                color: '#111827',
                cursor: 'pointer',
              }}
            >
              {copied ? (
                <>
                  <span aria-hidden="true">✓</span> Link copied
                </>
              ) : (
                'Copy link'
              )}
            </button>
            {manualCopy && !copied && (
              <span data-testid="manual-copy-message" style={{ fontSize: 12, color: '#FCD34D' }}>
                {MANUAL_COPY_MESSAGE}
              </span>
            )}
          </div>
          <p style={{ marginTop: 10, fontSize: 12, color: '#9CA3AF' }}>{COPY_NOTE}</p>
        </div>
      )}
    </div>
  );
}
