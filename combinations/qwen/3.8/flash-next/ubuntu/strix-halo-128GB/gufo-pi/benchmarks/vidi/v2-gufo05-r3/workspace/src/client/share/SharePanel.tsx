/**
 * The Share panel (story 5, `share.share_panel`).
 *
 * A Share button in the top-right of every board opens a small dialog holding the
 * board's full link and a Copy link button. Copying writes the link to the
 * clipboard and confirms with "Link copied"; when the browser will not allow that
 * (the API is missing, or `writeText` is rejected for permission or an insecure
 * context) the link is selected in the field and the manual-copy message appears
 * (share.copy_fallback).
 *
 * The panel is the product's one statement of the access model: possession of the
 * link is the only thing that lets someone in, and the note says so.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The full link to a board. Only characters chat and email do not re-encode. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

/** Security note shown in the panel (PRD: the access model in words). */
export const SHARE_NOTE = 'Anyone with this link can view and edit this board.';
/** Manual-copy fallback message (PRD `share.copy_fallback`). */
export const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

type CopyStatus = 'idle' | 'copied' | 'manual';

export interface SharePanelProps {
  boardId: string;
}

export function SharePanel({ boardId }: SharePanelProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CopyStatus>('idle');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const close = useCallback(() => {
    setOpen(false);
    setStatus('idle');
    if (copiedTimer.current !== null) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
    // Focus returns to the control that opened the panel (dialog convention).
    buttonRef.current?.focus();
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    setStatus('idle');
  }, []);

  // Close on Escape and on a pointer press outside the panel and its button.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  // Clear a pending revert on unmount.
  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  const fallBackToManual = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
    setStatus('manual');
  }, []);

  const copy = useCallback(async (): Promise<void> => {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      fallBackToManual();
      return;
    }
    try {
      await clipboard.writeText(link);
    } catch {
      fallBackToManual();
      return;
    }
    setStatus('copied');
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null;
      setStatus('idle');
    }, LINK_COPIED_MS);
  }, [link, fallBackToManual]);

  return (
    <div className="share" data-testid="share">
      <button
        type="button"
        ref={buttonRef}
        className="share-button"
        onClick={open ? close : openPanel}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Share
      </button>

      {open && (
        <div
          className="share-panel"
          role="dialog"
          aria-label="Share board"
          ref={panelRef}
          data-testid="share-panel"
        >
          <input
            type="text"
            ref={inputRef}
            className="share-link"
            readOnly
            value={link}
            aria-label="Board link"
            onClick={() => inputRef.current?.select()}
            data-testid="share-link"
          />
          <button
            type="button"
            className="share-copy"
            onClick={copy}
            data-testid="share-copy"
          >
            {status === 'copied' ? '\u2713 Link copied' : 'Copy link'}
          </button>
          <p className="share-note">{SHARE_NOTE}</p>
          {status === 'manual' && (
            <p className="share-manual" role="status" data-testid="share-manual">
              {MANUAL_COPY_MESSAGE}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
