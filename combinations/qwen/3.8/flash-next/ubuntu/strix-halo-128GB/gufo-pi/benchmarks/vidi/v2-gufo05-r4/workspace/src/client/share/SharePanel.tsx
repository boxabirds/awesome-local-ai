/**
 * Sharing a board by its address (`share.copy`).
 *
 * The panel's whole job is to move a URL into somebody else's hands. Three things follow
 * from that, and each is visible in the code because each has been a real problem:
 *
 *  - The link is the access control, so the panel says so in the panel rather than in a
 *    help page (`Anyone with this link can view and edit this board.`).
 *  - The clipboard is not a capability a page can assume. Safari and Firefox gate it, a
 *    non-secure origin has none at all, and a rejected promise is a normal Tuesday. When it
 *    fails the link is *selected in a field the person can see*, which is one keystroke from
 *    working everywhere (`share.copy_fallback`).
 *  - The confirmation is about the clipboard, not about the panel: "Link copied" is the
 *    button's own text, for `LINK_COPIED_MS`, and then it is the button again.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';
import { boardPath } from '../router';

/** The full address of a board — what gets pasted into a chat and into an address bar. */
export function boardLink(origin: string, id: string): string {
  return `${origin}${boardPath(id)}`;
}

/**
 * Which of the four things the panel is doing.
 *
 * `copied` and `manual` are both "open": the panel does not flicker out of the way after a
 * copy, because the person next to Maya is asking to be sent the link.
 */
type PanelState = 'closed' | 'open' | 'copied' | 'manual';

export interface SharePanelProps {
  boardId: string;
}

export function SharePanel({ boardId }: SharePanelProps): JSX.Element {
  const [panel, setPanel] = useState<PanelState>('closed');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  const open = panel !== 'closed';
  const link = boardLink(window.location.origin, boardId);

  /* Put the link in the field with its whole contents selected, and take the caret there:
     the person's next keystroke is Ctrl+C wherever the focus happens to be (`share.copy_fallback`). */
  const selectLink = useCallback(() => {
    const field = linkRef.current;
    if (field === null) return;
    field.select();
    field.focus();
  }, []);

  /* Focus the link as the panel opens, so the copy shortcut is one keystroke away
     (`share.copy` behaviour list). Keyed on *open*, not on the panel state: when "Link copied"
     expires there is no second jump on to the field — the focus stays where the person put it. */
  useEffect(() => {
    if (open) linkRef.current?.focus();
  }, [open]);

  /* "Link copied" is a confirmation, not a mode: it expires on its own and the button is
     copyable again. A second copy while it is showing simply restarts the same wait. */
  useEffect(() => {
    if (panel !== 'copied') return;
    const timer = setTimeout(() => setPanel('open'), LINK_COPIED_MS);
    return () => clearTimeout(timer);
  }, [panel]);

  const close = useCallback(() => {
    setPanel('closed');
    // Whatever the panel took the focus for, the person finishes where they started, so
    // Tab continues from the control they were looking at rather than at the top of the page.
    buttonRef.current?.focus();
  }, []);

  /* Escape and a click outside are the two ways out of an overlay, and both have to be
     listened for from outside it: nothing inside the panel is on screen to receive them. */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null) return;
      // A press on the Share button is the button's own business: its click closes the panel,
      // and closing here first would let the click open it again.
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  const copy = useCallback(async () => {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      // No clipboard at all: an insecure origin, an old browser, or one that has decided a
      // page may not write. The link is still going to work; the person just has to do the
      // last key press themselves.
      setPanel('manual');
      selectLink();
      return;
    }
    try {
      await clipboard.writeText(link);
    } catch {
      // Permission denied, or the document lost focus mid-write. Same answer as having no
      // clipboard: never "Copy failed", because nothing stopped working (`share.copy_fallback`).
      setPanel('manual');
      selectLink();
      return;
    }
    setPanel('copied');
  }, [link, selectLink]);

  return (
    <div className="vidi6-share">
      <button
        type="button"
        ref={buttonRef}
        className="vidi6-button vidi6-share__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setPanel('open'))}
      >
        Share
      </button>
      {open && (
        <div className="vidi6-share__panel" ref={panelRef} role="dialog" aria-label="Share board">
          <input
            className="vidi6-share__link"
            ref={linkRef}
            type="text"
            readOnly
            value={link}
            aria-label="Board link"
            // A click in the field means "I want this text", so give it to them whole.
            onClick={(event) => event.currentTarget.select()}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="vidi6-button vidi6-button--primary vidi6-share__copy"
            onClick={() => void copy()}
          >
            {panel === 'copied' ? '✓ Link copied' : 'Copy link'}
          </button>
          {/* The access model, said where the link is handed over: possession of this string
              is the only thing standing between the board and the world. */}
          <p className="vidi6-share__note">Anyone with this link can view and edit this board.</p>
          {panel === 'manual' && (
            <p className="vidi6-share__manual" role="status">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </div>
  );
}
