/**
 * Share panel (story 5, share.copy): the Share button in the top-right
 * corner and the panel that opens with the board link and Copy link.
 *
 * - The link is the current origin plus `/b/<boardId>` — nothing extra
 *   (token, origin prefix) — so it works when pasted into chat or email.
 * - Copy: navigator.clipboard.writeText when available; on rejection (or
 *   when the Clipboard API is absent) the link field is focused and fully
 *   selected and a "Press Ctrl+C (Cmd+C on Mac) to copy" hint shows.
 * - "Link copied" (tick) shows for LINK_COPIED_MS, then the button reverts.
 * - Escape or a click outside the panel closes it; focus returns to the
 *   Share button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The board link: origin + `/b/<id>` (share.copy). Exported for tests. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

/** PRD copy (share.copy). */
export const SHARE_NOTE = 'Anyone with this link can view and edit this board.';
export const MANUAL_COPY_TEXT = 'Press Ctrl+C (Cmd+C on Mac) to copy';

type PanelState = 'open' | 'copied' | 'manual_copy';

export function SharePanel({ boardId }: { boardId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState>('open');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const clearCopiedTimer = useCallback((): void => {
    if (copiedTimerRef.current !== null) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
  }, []);

  const selectLink = useCallback((): void => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }
    input.focus();
    input.select();
  }, []);

  const close = useCallback((): void => {
    clearCopiedTimer();
    setOpen(false);
    setState('open');
    buttonRef.current?.focus();
  }, [clearCopiedTimer]);

  const copy = useCallback((): void => {
    const clipboard =
      typeof navigator !== 'undefined' && navigator.clipboard !== undefined
        ? navigator.clipboard
        : undefined;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      // Clipboard API absent: fall back to a selected, focusable field.
      setState('manual_copy');
      selectLink();
      return;
    }
    void clipboard.writeText(link).then(
      () => {
        setState('copied');
        clearCopiedTimer();
        copiedTimerRef.current = setTimeout(() => {
          copiedTimerRef.current = null;
          setState('open');
        }, LINK_COPIED_MS);
      },
      () => {
        // Write rejected (permissions / policy): manual copy fallback.
        setState('manual_copy');
        selectLink();
      },
    );
  }, [link, clearCopiedTimer, selectLink]);

  // Escape closes while the panel is open.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // A click (pointerdown) outside the panel — and outside the Share button
  // it toggles from — closes it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node) {
        const inPanel = panelRef.current !== null && panelRef.current.contains(target);
        const onButton = buttonRef.current !== null && buttonRef.current.contains(target);
        if (!inPanel && !onButton) {
          close();
        }
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, close]);

  // Clean up the "Link copied" timer on unmount.
  useEffect(() => clearCopiedTimer, [clearCopiedTimer]);

  const copied = state === 'copied';
  return (
    <>
      <button
        ref={buttonRef}
        data-testid="share-button"
        onClick={() => {
          if (open) {
            close();
          } else {
            clearCopiedTimer();
            setState('open');
            setOpen(true);
            // Focus the link field when the panel opens (a11y + manual copy).
            requestAnimationFrame(selectLink);
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 3100,
          padding: '8px 16px',
          fontSize: 14,
          fontWeight: 600,
          background: '#111',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Share
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Share board"
          data-testid="share-panel"
          style={{
            position: 'fixed',
            top: 56,
            right: 16,
            zIndex: 3200,
            width: 340,
            padding: 16,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            fontFamily: 'system-ui, sans-serif',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <input
            ref={inputRef}
            readOnly
            data-testid="share-link-input"
            aria-label="Board link"
            value={link}
            onFocus={selectLink}
            onClick={selectLink}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              fontSize: 13,
              border: '1px solid #ccc',
              borderRadius: 6,
              background: '#fafafa',
              color: '#333',
            }}
          />
          <button
            data-testid="copy-link-button"
            onClick={copy}
            style={{
              padding: '8px 12px',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: copied ? '#1a7f37' : '#111',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {copied ? (
              <>
                <span aria-hidden="true">✓ </span>Link copied
              </>
            ) : (
              'Copy link'
            )}
          </button>
          {state === 'manual_copy' ? (
            <p role="alert" data-testid="manual-copy-hint" style={{ color: '#b00020', fontSize: 13, margin: 0 }}>
              {MANUAL_COPY_TEXT}
            </p>
          ) : null}
          <p data-testid="share-note" style={{ color: '#555', fontSize: 12, margin: 0 }}>
            {SHARE_NOTE}
          </p>
        </div>
      ) : null}
    </>
  );
}
