/**
 * The Share panel (PRD `share.share_panel`).
 *
 * A board's link *is* the way in — there is no sign-in, and story 14 adds one without
 * adding permissions — so the panel has two jobs: hand over the link, and say out loud
 * what handing it over means. The note under the field, "Anyone with this link can view
 * and edit this board.", is not decoration; it is the security model written in the one
 * place a person is about to make a decision about it.
 *
 * Copying is where the browser gets involved, and browsers disagree. `navigator.clipboard`
 * may be missing (a non-secure origin), it may be there and refuse (permissions), or it may
 * work. All three are handled by doing the useful thing rather than reporting a fault: when
 * automatic copying is not available the link is selected in the field and the panel says
 * "Press Ctrl+C (Cmd+C on Mac) to copy" — the person ends up with the link either way,
 * which is the only promise the feature makes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import { LINK_COPIED_MS } from '../../shared/config.js';
import { boardPath } from '../router.js';

/**
 * The full link to a board. Takes the origin rather than reading `window` so it can be
 * asserted against an address that is not the one the test is running on.
 */
export function boardLink(origin: string, id: string): string {
  return `${origin}${boardPath(id)}`;
}

/** PRD `share.copy`: how long the confirmation is held. */
const COPIED_MESSAGE = 'Link copied';

/** PRD `share.copy_fallback`: what to say when the browser will not copy for us. */
const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

/** PRD `share.share_panel`: the security model, in the panel where it matters. */
export const SHARE_NOTE = 'Anyone with this link can view and edit this board.';

/** What the panel's copy button says when it is not confirming something. */
const COPY_LABEL = 'Copy link';

type CopyState = 'ready' | 'copied' | 'manual';

export interface SharePanelProps {
  boardId: string;
}

/**
 * The Share button, and the panel it opens.
 *
 * The button is always there; the panel is mounted only while it is open, so there is no
 * hidden dialog for a screen reader to find. Focus goes into the panel when it opens and
 * back to the button when it closes, because a panel that swallows the keyboard is a panel
 * that has moved the person somewhere they cannot get back from.
 */
export function SharePanel({ boardId }: SharePanelProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>('ready');

  const link = boardLink(window.location.origin, boardId);

  const root = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // The confirmation is a timer, and a timer that outlives the panel it was set for is a
  // panel that changes its own label two seconds after it was closed.
  useEffect(() => clearTimer, [clearTimer]);

  const close = useCallback((): void => {
    clearTimer();
    setOpen(false);
    setCopy('ready');
    // Back to where the person was standing. Without this the keyboard is left behind in
    // a button that is no longer on the screen.
    trigger.current?.focus();
  }, [clearTimer]);

  const askForItManually = useCallback((): void => {
    setCopy('manual');
    // The link is the deliverable, so the field is what gets the selection and the focus:
    // the keystroke the message asks for has to land somewhere that has the text.
    field.current?.focus();
    field.current?.select();
  }, []);

  const copyLink = useCallback((): void => {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      askForItManually();
      return;
    }
    // A browser whose user gesture has already gone can throw here instead of rejecting, so
    // the call is wrapped: the promise this function returns to the click handler is one
    // that cannot escape.
    let done: Promise<void>;
    try {
      done = clipboard.writeText(link);
    } catch {
      askForItManually();
      return;
    }
    done
      .then(() => {
        clearTimer();
        setCopy('copied');
        // A copy two seconds ago should not be confirmed a third time, so a new copy
        // restarts the countdown instead of adding to it.
        timer.current = setTimeout(() => {
          timer.current = null;
          setCopy('ready');
        }, LINK_COPIED_MS);
      })
      // A rejection is "the browser will not do this", which is the case the message is for.
      .catch(() => {
        askForItManually();
      });
  }, [askForItManually, clearTimer, link]);

  const openPanel = useCallback((): void => {
    setOpen(true);
    setCopy('ready');
  }, []);

  // The link is the reason for the panel, so it is selected on the way in: on a browser
  // where the clipboard works this is one click from Ctrl+C, and on one where it does not
  // it is already ready to be copied by hand. An effect rather than the click handler,
  // because the field does not exist until the panel does.
  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    field.current?.select();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) close();
    };

    window.addEventListener('keydown', onKeyDown);
    // The capture phase: the panel closes on a click that starts outside it, and a click
    // on a note outside it should close the panel *and* not have to be clicked twice.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  return (
    <div className="share" ref={root}>
      <button
        type="button"
        className="share-button"
        data-testid="share-button"
        ref={trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openPanel())}
      >
        Share
      </button>

      {open ? (
        <div className="share-panel" role="dialog" aria-label="Share board" data-testid="share-panel">
          <label className="share-field-label" htmlFor="share-link">
            Board link
          </label>
          <div className="share-row">
            <input
              id="share-link"
              className="share-link"
              data-testid="share-link"
              ref={field}
              type="text"
              readOnly
              value={link}
              // A read-only field that cannot be selected by clicking it is a read-only
              // field that has the link in it for decoration.
              onClick={() => field.current?.select()}
            />
            <button
              type="button"
              className="share-copy"
              data-testid="copy-link-button"
              data-copied={copy === 'copied' ? 'true' : 'false'}
              onClick={copyLink}
            >
              {copy === 'copied' ? `\u2713 ${COPIED_MESSAGE}` : COPY_LABEL}
            </button>
          </div>

          <p className="share-note" data-testid="share-note">
            {SHARE_NOTE}
          </p>

          {/* The manual path is said where the confirmation would otherwise have been: it
              is the same slot, for the same reason — a word about what just happened. */}
          {copy === 'manual' ? (
            <p className="share-manual" data-testid="share-manual" role="status">
              {MANUAL_COPY_MESSAGE}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
