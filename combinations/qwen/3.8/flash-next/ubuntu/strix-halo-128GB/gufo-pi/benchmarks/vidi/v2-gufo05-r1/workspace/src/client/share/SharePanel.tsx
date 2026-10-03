/**
 * The Share panel: this board's link, and one button that puts it on the clipboard.
 *
 * The whole feature is one string, so the design question is what to do when the string
 * cannot be copied for you. Two things happen in that case, in this order:
 *
 *   1. the link is already selected in the field, because the field is focused when the
 *      panel opens — so `Ctrl+C` works without anything else; and
 *   2. if the clipboard call itself fails (no permission, no clipboard, a browser that
 *      refuses a background write), the panel says to press `Ctrl+C` and stays open.
 *
 * What never happens is a message that says it worked. "Link copied" is only shown after
 * the clipboard promise resolved, and it is taken back after `LINK_COPIED_MS` so that the
 * next press reports the next attempt. A person who was told "copied" and pasted nothing
 * would not try this board again.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { LINK_COPIED_MS } from '../../shared/config';
import { boardPath } from '../router';

/**
 * The address of a board. The link *is* the permission, so this string is worth care:
 * it is built from the page's own origin (never a stored or guessed one) and from the
 * router's path, so what a person copies is the address this app would route.
 */
export function boardLink(origin: string, boardId: string): string {
  return `${origin}${boardPath(boardId)}`;
}

export function SharePanel({ boardId }: { boardId: string }): JSX.Element {
  const link = boardLink(window.location.origin, boardId);
  const [open, setOpen] = useState(false);
  // Two separate facts, because they can be true together: the last copy worked, and the
  // one before it did not and left the field selected.
  const [copied, setCopied] = useState(false);
  const [needsManualCopy, setNeedsManualCopy] = useState(false);

  const shareButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The message is a moment, not a state to live in; the timer is cancelled with the
  // panel so a close cannot leave a "copied" behind for the next board.
  useEffect(
    () => () => {
      if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    setNeedsManualCopy(false);
    // Focus goes back where it came from. Left on a panel that is no longer there, the
    // next Tab would start from the top of the page.
    shareButton.current?.focus();
  }, []);

  // The link is what they came for, so it is what gets focus — and a selected link is a
  // copyable one, whether or not the clipboard ever answers.
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    input.current?.select();
  }, [open]);

  // Escape, or a click anywhere outside, ends the conversation about sharing.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node) {
        if (panel.current?.contains(target) === true) return;
        if (shareButton.current?.contains(target) === true) return;
      }
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  /** Leave the link selected and say what to press. The panel stays open. */
  const askManualCopy = () => {
    setCopied(false);
    setNeedsManualCopy(true);
    input.current?.focus();
    input.current?.select();
  };

  const copy = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      // No clipboard to ask. The field is already selected, which is the other way.
      askManualCopy();
      return;
    }
    clipboard
      .writeText(link)
      .then(() => {
        setNeedsManualCopy(false);
        setCopied(true);
        if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => {
          setCopied(false);
        }, LINK_COPIED_MS);
      })
      // A rejection is the browser saying no, not a thing to report as a success.
      .catch(() => {
        askManualCopy();
      });
  };

  return (
    <div className="share">
      <button
        type="button"
        className="share__button"
        ref={shareButton}
        aria-expanded={open}
        aria-controls="share-panel"
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
      >
        Share
      </button>
      {open ? (
        <div className="share__panel" id="share-panel" role="dialog" aria-label="Share board" ref={panel}>
          <p className="share__note">Anyone with this link can view and edit this board.</p>
          <div className="share__row">
            {/* Read-only, and selectable as-is: the value is the thing, not a field. */}
            <input
              className="share__input"
              ref={input}
              type="text"
              readOnly
              value={link}
              aria-label="Board link"
              onClick={(event) => {
                event.currentTarget.select();
              }}
            />
            <button type="button" className="share__copy" onClick={copy}>
              {copied ? (
                <>
                  {/* The tick is decoration; the words are the message. */}
                  <span aria-hidden="true">✓ </span>
                  Link copied
                </>
              ) : (
                'Copy link'
              )}
            </button>
          </div>
          {needsManualCopy ? (
            <p className="share__hint" role="status">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
