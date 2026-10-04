/**
 * The Share panel: the board's link, and one button that puts it on the clipboard
 * (share.share_panel).
 *
 * A board's link is the whole of how people get onto it, so this panel's job is to
 * hand it over without the person having to read it out of the address bar. Two
 * things are worth knowing about the clipboard API: it only works on a page the
 * browser considers secure, and it can be refused. Both fail the same way — the copy
 * does not happen — and the answer is not an error message but the link, already
 * selected in a field, with the words "Press Ctrl+C (Cmd+C on Mac) to copy" beside it.
 * That path works everywhere, including over plain http on a phone, which is exactly
 * where a copied link is most often wanted (share.copy_fallback).
 *
 * "Link copied" is a confirmation, not a screen: it holds for LINK_COPIED_MS and then
 * the button is a Copy button again, still open, because the person is most likely
 * about to paste the link somewhere and the panel closing under them would be the one
 * annoying thing this could do (share.copy).
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';

import { LINK_COPIED_MS } from '../../shared/config';
import { boardPath } from '../router';

/** The panel's whole shape: shut, or open with what it is confirming. */
export type SharePanelState =
  | { kind: 'closed' }
  | { kind: 'open'; copied: boolean; manual: boolean };

export type SharePanelEvent =
  | { type: 'opened' }
  | { type: 'closed' }
  | { type: 'copy_succeeded' }
  | { type: 'copy_failed' };

/**
 * The panel's states, as the design's diagram: `Closed`, `Open`, `Copied`,
 * `ManualCopy` — where the last two are the open panel with something to report, not
 * separate screens.
 *
 * A copy result only counts on a panel that is still open. Someone who pressed Escape
 * while the write was in flight has left; a panel reappearing in front of them, or a
 * confirmation of a copy they can no longer see, would be worse than saying nothing.
 */
export function nextSharePanelState(
  state: SharePanelState,
  event: SharePanelEvent,
): SharePanelState {
  switch (event.type) {
    case 'opened':
      return { kind: 'open', copied: false, manual: false };
    case 'closed':
      return { kind: 'closed' };
    case 'copy_succeeded':
      // Only ever on an open panel: a confirmation nobody can see is not one, and a
      // panel that was closed while the write was in flight stays closed.
      return state.kind === 'open' ? { kind: 'open', copied: true, manual: false } : state;
    case 'copy_failed':
      return state.kind === 'open' ? { kind: 'open', copied: false, manual: true } : state;
  }
}

/** A board's link: an absolute address, because it is meant to leave this page. */
export function boardLink(origin: string, boardId: string): string {
  return `${origin.replace(/\/+$/, '')}${boardPath(boardId)}`;
}

export function SharePanel({ boardId }: { boardId: string }) {
  const [state, dispatch] = useReducer(nextSharePanelState, { kind: 'closed' } as SharePanelState);
  const shareButton = useRef<HTMLButtonElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const linkField = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const open = state.kind === 'open';
  const copied = state.kind === 'open' && state.copied;
  const manual = state.kind === 'open' && state.manual;
  const link = boardLink(window.location.origin, boardId);

  const close = useCallback(() => {
    dispatch({ type: 'closed' });
    // Focus goes back where it came from, so the keyboard does not lose its place in
    // a panel that is no longer there.
    shareButton.current?.focus();
  }, []);

  /** The clipboard said no: the link is shown ready to copy by hand. */
  const copyByHand = useCallback(() => {
    dispatch({ type: 'copy_failed' });
    // Selected and focused, so the next thing the person presses is Ctrl+C and it
    // works wherever the focus is (share.copy_fallback).
    linkField.current?.focus();
    linkField.current?.select();
  }, []);

  const copy = useCallback(async () => {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      // No clipboard at all (insecure origin, old browser): the fallback, not a
      // failure to explain (share.copy_fallback).
      copyByHand();
      return;
    }
    try {
      await clipboard.writeText(link);
      dispatch({ type: 'copy_succeeded' });
    } catch {
      copyByHand();
    }
  }, [link, copyByHand]);

  // The panel takes the keyboard when it opens: the copy button is the one thing
  // anybody comes here for.
  useEffect(() => {
    if (open) copyButton.current?.focus();
  }, [open]);

  // "Link copied" holds for its moment and then the button is a Copy button again —
  // the panel stays open, because the person is about to paste (share.copy).
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => dispatch({ type: 'opened' }), LINK_COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // Escape, or a click anywhere outside, closes it. The Share button itself is
  // excluded so that clicking it again closes the panel once, not twice.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panel.current?.contains(target) || shareButton.current?.contains(target)) return;
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  return (
    <div className="share">
      <button
        ref={shareButton}
        type="button"
        className="share-open"
        data-testid="share-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => dispatch(open ? { type: 'closed' } : { type: 'opened' })}
      >
        Share
      </button>

      {open && (
        <div
          className="share-panel"
          data-testid="share-panel"
          role="dialog"
          aria-label="Share board"
          ref={panel}
        >
          <p className="share-note">Anyone with this link can view and edit this board.</p>
          <div className="share-row">
            {/* Read-only and selectable: the link is the thing being handed over, so
                it is shown in full and clicking it selects all of it. */}
            <input
              ref={linkField}
              className="share-link"
              data-testid="share-link"
              value={link}
              readOnly
              aria-label="Board link"
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
            />
            <button
              ref={copyButton}
              type="button"
              className="share-copy"
              data-testid="share-copy"
              onClick={() => void copy()}
            >
              {copied ? (
                <>
                  {/* The tick is decoration; the words are the accessible name. */}
                  <span className="share-tick" aria-hidden="true">
                    ✓
                  </span>
                  Link copied
                </>
              ) : (
                'Copy link'
              )}
            </button>
          </div>
          {manual && (
            <p className="share-manual" data-testid="share-manual" role="status">
              Your browser would not let us copy the link, so it is selected below. Press Ctrl+C (Cmd+C
              on Mac) to copy
            </p>
          )}
        </div>
      )}
    </div>
  );
}
