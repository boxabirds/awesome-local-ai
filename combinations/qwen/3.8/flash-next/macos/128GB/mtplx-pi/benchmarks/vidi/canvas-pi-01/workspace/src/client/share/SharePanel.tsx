/**
 * Story 5 · the Share panel (design "Share panel", PRD share.copy).
 *
 * One button, one panel. The panel holds the board's full link in a read-only
 * field (clicking it selects the whole link), a Copy link button and the
 * sentence that states the security model out loud: *anyone with this link can
 * view and edit this board* (PRD Constraints).
 *
 * Copy has three outcomes and all three are UI states, not exceptions:
 *  - the clipboard accepts the text → "Link copied" for `LINK_COPIED_MS`;
 *  - it rejects (no permission, insecure context) → manual-copy mode;
 *  - `navigator.clipboard` does not exist at all → the same manual mode,
 *    because that is exactly the case the fallback was designed for.
 *
 * Manual mode selects the field and focuses it, so the next Ctrl/Cmd+C on the
 * keyboard copies the link with no further aiming (PRD share.copy_fallback).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export const SHARE_BUTTON_LABEL = 'Share';
export const COPY_LABEL = 'Copy link';
export const COPIED_LABEL = 'Link copied';
export const SHARE_NOTE = 'Anyone with this link can view and edit this board.';
export const MANUAL_COPY_TEXT = 'Press Ctrl+C (Cmd+C on Mac) to copy';

/** The panel state (`open` = nothing copied yet, PRD share.copy). */
export type ShareState = 'closed' | 'open' | 'copied' | 'manual';

/** A board's share link: the address a second person pastes to join. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

/**
 * The link the panel offers. `window.location.origin` in the browser; the
 * component tests pass their own origin so the assertion on the full URL stays
 * a literal string rather than a concatenation of the same source.
 */
export function shareLinkFor(id: string, origin?: string): string {
  const base =
    origin ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  return boardLink(base, id);
}

export interface SharePanelProps {
  boardId: string;
  /** Test seam: the clipboard to use. Defaults to `navigator.clipboard`. */
  clipboard?: { writeText(text: string): Promise<void> } | undefined;
  /** Test seam: origin for the link (defaults to the page's). */
  origin?: string;
}

export function SharePanel({ boardId, clipboard, origin }: SharePanelProps) {
  const [state, setState] = useState<ShareState>('closed');
  const link = shareLinkFor(boardId, origin);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The "Link copied" confirmation is a timer, not a state the visitor has to
  // dismiss; it is cleared whenever the panel is closed or re-armed.
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCopiedTimer = () => {
    if (copiedTimer.current !== null) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
  };

  const close = useCallback(() => {
    clearCopiedTimer();
    setState('closed');
    // Focus returns where the visitor started, so the keyboard does not lose
    // its place when the panel goes away.
    buttonRef.current?.focus();
  }, []);

  // Escape closes the panel, and so does a pointerdown anywhere outside it.
  // Both are window-level because the panel is not a modal: the board behind it
  // stays interactive.
  useEffect(() => {
    if (state === 'closed') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [state, close]);

  // The copy timer must not outlive the panel.
  useEffect(() => clearCopiedTimer, []);

  const selectField = () => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  };

  const open = () => {
    // A second click on the same button dismisses the panel: it is a toggle,
    // not a one-way reveal (PRD share.copy: the panel is dismissed by
    // "Click Share again, click anywhere outside, press Escape").
    if (state === 'closed') {
      clearCopiedTimer();
      setState('open');
    } else {
      close();
    }
  };

  const copy = async () => {
    const writer = clipboard ?? navigator.clipboard;
    if (writer === undefined || typeof writer.writeText !== 'function') {
      // No clipboard API at all (insecure context, older engine).
      setState('manual');
      selectField();
      return;
    }
    try {
      await writer.writeText(link);
      clearCopiedTimer();
      setState('copied');
      copiedTimer.current = setTimeout(() => {
        copiedTimer.current = null;
        setState('open');
      }, LINK_COPIED_MS);
    } catch {
      setState('manual');
      selectField();
    }
  };

  if (state === 'closed') {
    return (
      <div className="share-closed" data-testid="share-closed">
        <button
          type="button"
          ref={buttonRef}
          className="share-button"
          aria-haspopup="dialog"
          aria-expanded={false}
          data-testid="share-button"
          onClick={open}
        >
          {SHARE_BUTTON_LABEL}
        </button>
      </div>
    );
  }

  return (
    <div className="share-closed" data-testid="share-closed">
      <button
        type="button"
        ref={buttonRef}
        className="share-button"
        aria-haspopup="dialog"
        aria-expanded
        data-testid="share-button"
        onClick={open}
      >
        {SHARE_BUTTON_LABEL}
      </button>
      <div
        className="share-panel"
        role="dialog"
        aria-label="Share board"
        ref={panelRef}
        data-testid="share-panel"
      >
        <input
          ref={fieldRef}
          className="share-field"
          type="text"
          readOnly
          value={link}
          aria-label="Board link"
          data-testid="share-link"
          onClick={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="share-copy"
          data-testid="share-copy"
          onClick={() => void copy()}
        >
          {state === 'copied' ? `\u2713 ${COPIED_LABEL}` : COPY_LABEL}
        </button>
        <p className="share-note" data-testid="share-note">
          {SHARE_NOTE}
        </p>
        {state === 'manual' && (
          <p className="share-manual" role="status" data-testid="share-manual">
            {MANUAL_COPY_TEXT}
          </p>
        )}
      </div>
    </div>
  );
}
