// The Share control (story 5, PRD share.copy / share.copy_fallback): a button in
// the top-right of the board page that opens a small panel holding this board's
// link in a read-only field, with a Copy link button.
//
// The link is the board page's own address, query string aside: for this product
// the address of a board IS its link — possession of it is the whole access model,
// which the panel says out loud — and a debug or test parameter must never end up
// in a link someone pastes into chat.
//
// The panel stays mounted around one persistent Share button, so closing it has
// somewhere to return focus to.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config.ts';
import { copyTextToClipboard } from './clipboard.ts';

const COPY_LABEL = 'Copy link';
const COPIED_LABEL = 'Link copied';
/** The tick that goes with "Link copied" (PRD share.copy), for LINK_COPIED_MS. */
const COPIED_TICK = '\u2713';
const MANUAL_COPY_HINT = 'Press Ctrl+C (Cmd+C on Mac) to copy';
/** The interim security model, stated where the link is handed out (PRD Constraints). */
const SECURITY_NOTE = 'Anyone with this link can view and edit this board.';

/**
 * This board's link: the page's origin and path, absolute so it works pasted
 * anywhere, without the query string or hash.
 */
export function boardLink(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export default function SharePanel() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const linkRef = useRef<HTMLInputElement | null>(null);
  // The "Link copied" reset. Kept in a ref and cleared on re-open and on unmount,
  // so a second copy cannot have its confirmation cancelled by the first copy's
  // timer.
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // An answer from the clipboard that arrives after the board page was navigated
  // away from must not set state on an unmounted component.
  const unmounted = useRef(false);

  useEffect(
    () => () => {
      unmounted.current = true;
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const close = useCallback(() => {
    setOpen(false);
    setManualCopy(false);
    // Focus goes back where the visitor came from, so the keyboard does not get
    // lost in the document after the panel is dismissed.
    buttonRef.current?.focus();
  }, []);

  // Only while open: Escape closes, and a pointer press anywhere outside the
  // panel closes it. The press is listened for on the document because the panel
  // has no backdrop of its own — the board behind it stays visible.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const wrapper = wrapperRef.current;
      if (wrapper && event.target instanceof Node && !wrapper.contains(event.target)) close();
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  async function copyLink(): Promise<void> {
    const link = boardLink();
    setManualCopy(false);
    const written = await copyTextToClipboard(link);
    if (unmounted.current) return;
    if (written) {
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), LINK_COPIED_MS);
      return;
    }
    // The browser would not write the clipboard. Put the link in the visitor's
    // hands instead: the whole of it selected in the field, with the keystroke to
    // press spelled out (share.copy_fallback).
    const field = linkRef.current;
    if (field) {
      field.focus();
      field.setSelectionRange(0, field.value.length);
    }
    setManualCopy(true);
  }

  function toggle(): void {
    if (open) {
      close();
      return;
    }
    setCopied(false);
    setManualCopy(false);
    setOpen(true);
  }

  return (
    <div className="share" data-testid="share" ref={wrapperRef}>
      <button
        type="button"
        className="share-button"
        data-testid="share-button"
        ref={buttonRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        Share
      </button>
      {open && (
        <div className="share-panel" role="dialog" aria-label="Share board">
          <div className="share-row">
            <input
              ref={linkRef}
              type="text"
              className="share-link"
              data-testid="share-link"
              readOnly
              value={boardLink()}
              aria-label="Board link"
              // Clicking in the field selects the whole link, so the manual-copy
              // path works from the field alone (share.copy_fallback).
              onFocus={(event) =>
                event.currentTarget.setSelectionRange(0, event.currentTarget.value.length)
              }
            />
            <button
              type="button"
              className="share-copy"
              data-testid="share-copy"
              onClick={() => void copyLink()}
            >
              {copied ? `${COPIED_LABEL} ${COPIED_TICK}` : COPY_LABEL}
            </button>
          </div>
          {manualCopy && (
            <p className="share-manual" role="status" data-testid="share-manual">
              {MANUAL_COPY_HINT}
            </p>
          )}
          <p className="share-note" data-testid="share-note">
            {SECURITY_NOTE}
          </p>
          <button type="button" className="share-close" onClick={close} data-testid="share-close">
            Close
          </button>
        </div>
      )}
    </div>
  );
}
