import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The shareable link for a board: full URL, no query params (share.share_panel). */
export function boardLink(origin: string, boardId: string): string {
  return `${origin}/b/${boardId}`;
}

/**
 * The share control (story 5, share.share_panel): a top-right "Share" button
 * that opens a small panel with the board's full link. Copying uses the
 * async Clipboard API with a manual-copy fallback (the whole link is
 * selected and a "press Ctrl/Cmd+C" hint is shown) when the clipboard is
 * unavailable or the write is rejected. Success shows "Link copied" for
 * LINK_COPIED_MS. Escape and outside clicks close the panel and return
 * focus to the Share button.
 */
export function SharePanel(props: { boardId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const link = boardLink(window.location.origin, props.boardId);

  const selectLink = useCallback(() => {
    const el = inputRef.current;
    if (el === null) return;
    el.focus();
    el.select();
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    setManualCopy(false);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    shareButtonRef.current?.focus();
  }, []);

  // Escape and outside-click close the panel (capture phase so the board's
  // own key handlers see Escape only when the panel is closed).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (shareButtonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const toggle = () => {
    if (open) close();
    else {
      setCopied(false);
      setManualCopy(false);
      setOpen(true);
    }
  };

  const copy = () => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      // Clipboard API unavailable (insecure context, old browser): manual.
      selectLink();
      setManualCopy(true);
      return;
    }
    void clipboard.writeText(link).then(
      () => {
        setManualCopy(false);
        setCopied(true);
        if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), LINK_COPIED_MS);
      },
      () => {
        // Write rejected (permissions): fall back to manual copy.
        selectLink();
        setManualCopy(true);
      },
    );
  };

  return (
    <>
      <button
        ref={shareButtonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: 25,
          padding: '8px 16px',
          fontSize: 14,
          borderRadius: 8,
          border: '1px solid #cbd5e1',
          background: '#fff',
          color: '#334155',
          cursor: 'pointer',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        Share
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Share board"
          style={{
            position: 'fixed',
            top: 52,
            right: 12,
            zIndex: 25,
            width: 340,
            padding: 12,
            borderRadius: 10,
            border: '1px solid #cbd5e1',
            background: '#fff',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <input
            ref={inputRef}
            readOnly
            aria-label="Board link"
            value={link}
            onClick={(e) => e.currentTarget.select()}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '6px 8px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              color: '#334155',
            }}
          />
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={copy}
              style={{
                padding: '6px 14px',
                fontSize: 14,
                borderRadius: 6,
                border: 'none',
                background: copied ? '#16a34a' : '#2563eb',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              {copied ? (
                <>
                  <span aria-hidden="true">✓ </span>
                  Link copied
                </>
              ) : (
                'Copy link'
              )}
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#64748b' }}>
            Anyone with this link can view and edit this board.
          </p>
          {manualCopy && (
            <p role="alert" style={{ margin: '8px 0 0', fontSize: 12, color: '#b45309' }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </>
  );
}
