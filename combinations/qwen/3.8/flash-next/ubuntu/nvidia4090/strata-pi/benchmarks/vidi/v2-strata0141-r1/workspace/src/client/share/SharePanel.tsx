import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';
import { boardPath } from '../router';

/**
 * Share a board (`share.copy_link`).
 *
 * A board's address *is* its link - anyone who has it can open the board, and
 * there is nothing else to hand over. So the panel shows the address in full and
 * puts it on the clipboard.
 *
 * The fallback is not a decoration. A browser refuses `navigator.clipboard` in a
 * hundred ordinary ways (no permission, an insecure page, a user gesture the
 * browser did not count), and when it does the link is still on screen in a field
 * with its text selected, so copying it by hand is one keystroke away.
 */

export function boardLink(boardId: string, origin: string = window.location.origin): string {
  return `${origin}${boardPath(boardId)}`;
}

const MANUAL_MESSAGE = 'Copy the link above';

export function SharePanel({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const link = boardLink(boardId);

  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    setManual(false);
    // The panel closes and the focus goes back where it came from, so the keyboard
    // never lands on something that is no longer on the page.
    buttonRef.current?.focus();
  }, []);

  /* Escape and a click outside both close the panel. */
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null) {
        return;
      }
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) {
        return;
      }
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [close, open]);

  /* "Link copied" is a confirmation, not a new steady state. */
  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = setTimeout(() => setCopied(false), LINK_COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const showManualCopy = useCallback(() => {
    setManual(true);
    setCopied(false);
    const input = inputRef.current;
    if (input !== null) {
      input.focus();
      input.select();
    }
  }, []);

  const copy = useCallback(async () => {
    const clipboard = navigator.clipboard;
    if (typeof clipboard?.writeText !== 'function') {
      showManualCopy();
      return;
    }
    try {
      await clipboard.writeText(link);
      setManual(false);
      setCopied(true);
    } catch {
      showManualCopy();
    }
  }, [link, showManualCopy]);

  return (
    <div className="share" data-testid="share" data-board-chrome="true">
      <button
        ref={buttonRef}
        type="button"
        className="share__button"
        data-testid="share-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setOpen(true);
          setCopied(false);
          setManual(false);
        }}
      >
        Share
      </button>

      {open ? (
        <div ref={panelRef} className="share__panel" data-testid="share-panel" role="dialog" aria-label="Share this board">
          <label className="share__label" htmlFor="share-link">
            Board link
          </label>
          <input
            ref={inputRef}
            id="share-link"
            className="share__link"
            data-testid="share-link"
            type="text"
            readOnly
            value={link}
            onFocus={(event) => {
              // Clicking once puts the whole link on the clipboard's doorstep.
              event.currentTarget.select();
            }}
            onClick={(event) => {
              event.currentTarget.select();
            }}
          />
          <button
            type="button"
            className="share__copy"
            data-testid="share-copy"
            onClick={() => {
              void copy();
            }}
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          {manual ? (
            <p className="share__manual" data-testid="share-manual" role="status">
              {MANUAL_MESSAGE}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
