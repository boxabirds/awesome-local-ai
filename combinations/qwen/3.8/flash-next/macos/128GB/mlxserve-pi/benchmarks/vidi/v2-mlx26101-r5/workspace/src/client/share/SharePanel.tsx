/**
 * The Share button, the panel behind it, and the one click that hands a board to somebody.
 *
 * The panel is deliberately small: the link, the button that copies it, and one line saying
 * what the link is worth ("Anyone with this link can view and edit this board") — which is not
 * decoration but the whole security model of every story up to this one, said out loud where
 * somebody is about to paste it into a chat.
 *
 * Three things about the copy are decisions rather than habits:
 *
 * **The link is on screen, in a field, not only on the clipboard.** A person who cannot see
 * what was copied cannot check it, and a clipboard is a black box for exactly that reason. The
 * field is read-only and selects its whole contents on a click, so a link can be taken with a
 * drag and a right-click even when nothing else works.
 *
 * **A clipboard we cannot use is not an error.** `navigator.clipboard` is absent outside secure
 * contexts and rejects on refusal, both of which happen in real browsers on real boards. Either
 * way the panel does the same thing: selects the link and says how to copy it by hand
 * (`share.copy_fallback`). The alternative is a "Copy failed" message that leaves the person no
 * worse off with a link they could not have got anyway.
 *
 * **"Link copied" is a fact about this click, not about the board.** It is put back by a timer,
 * because a message that stays up forever is a message that stops being read — and because a
 * second copy of a changed link has to be able to say so again.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { LINK_COPIED_MS } from '../../shared/config';
import { boardPath } from '../router';

/** How long "Link copied" stays up. The PRD's two seconds, in one named place. */
export const LINK_COPIED_FEEDBACK_MS = LINK_COPIED_MS;

/** The button that opens the panel. */
export const SHARE_LABEL = 'Share';

/** The button that puts the link on the clipboard. */
export const COPY_LINK_LABEL = 'Copy link';

/** `share.copy`: the confirmation, for `LINK_COPIED_MS`. */
export const LINK_COPIED_MESSAGE = 'Link copied';

/** `share.copy_fallback`: what to do when the clipboard is not available to us. */
export const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

/** The security model, said out loud, because possession of the link is the whole of it. */
export const SHARE_NOTE = 'Anyone with this link can view and edit this board.';

/**
 * The whole address of a board — where it is served from, and which board.
 *
 * Takes a location instead of reading one, so that the panel a test renders can be given an
 * address the test wrote down, and so that the assertion "the copied text is a full https link"
 * is about a string rather than about whatever jsdom thinks its origin is.
 */
export function boardLink(origin: string, boardId: string): string {
  return `${origin.replace(/\/+$/, '')}${boardPath(boardId)}`;
}

export interface SharePanelProps {
  /** The board being shared. */
  boardId: string;
  /** Where this page is served from. Defaults to the page's own origin. */
  origin?: string;
  /** The clipboard, as `(text) => Promise`. Defaults to `navigator.clipboard.writeText`. */
  copy?: (text: string) => Promise<void>;
  /** Told when the person closed the panel. */
  onClose?: () => void;
}

/** Which way the panel went after the click. */
type CopyState = 'idle' | 'copied' | 'manual';

/**
 * The Share button and the panel behind it.
 *
 * Open, and one of three things about the last copy attempt: it worked, it is going to be said
 * for two seconds; it did not work or there was nothing to work with, and the link is selected
 * instead; or nobody has clicked yet.
 */
export function SharePanel({ boardId, origin, copy, onClose }: SharePanelProps): React.JSX.Element {
  const link = boardLink(origin ?? readOrigin(), boardId);
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const wrapper = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Puts the whole link under the person's hands: focused, and selected. */
  const reveal = useCallback(() => {
    const input = field.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const copyLink = useCallback((): void => {
    const write = copy ?? clipboardCopy();
    if (!write) {
      // No clipboard at all. The link is on screen and selected; that is the whole answer.
      setCopyState('manual');
      reveal();
      return;
    }
    void (async () => {
      try {
        await write(link);
        setCopyState('copied');
        if (timer.current !== null) clearTimeout(timer.current);
        // "Link copied" is about this click. After two seconds the button is a button again,
        // ready to say it about the next one.
        timer.current = setTimeout(() => setCopyState('idle'), LINK_COPIED_FEEDBACK_MS);
      } catch {
        // Refused, blocked, or gone since we looked: same as never having had one.
        setCopyState('manual');
        reveal();
      }
    })();
  }, [copy, link, reveal]);

  const close = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    setOpen(false);
    // Back to the beginning: a panel that was closed while it said "Link copied" must not open
    // again saying something that happened last time.
    setCopyState('idle');
    onClose?.();
  }, [onClose]);

  // Escape and any click outside the panel close it — the two ways a person finishes with a
  // panel without looking for its close button. Both are on the document, because a click that
  // lands on the board behind the panel is a click that never reaches this component.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target && wrapper.current && !wrapper.current.contains(target)) close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('click', onClick);
    };
  }, [open, close]);

  // The countdown does not outlive the panel.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  // A panel that was open when the person moved to another board is closed, not carried over:
  // the link in it belongs to the board they left.
  useEffect(() => {
    setOpen(false);
    setCopyState('idle');
  }, [boardId]);

  // One tree whether the panel is open or not, and the button that opens it is in the wrapper the
  // panel is in. That is not tidiness: the panel closes on a click outside itself, and the click
  // that *opens* it is still travelling towards the document while the panel is being built. Give
  // the open state a different tree and that click arrives with its own button no longer inside the
  // panel — an outside click, heard in the same millisecond as the opening, and the panel closes
  // itself out of existence. jsdom hands events to the document before React builds anything, so
  // only a real browser does this; it is what TC-26 found.
  return (
    <div className="share" data-testid="share" ref={wrapper}>
      <button
        type="button"
        className="share-button"
        data-testid="share-button"
        onClick={open ? close : () => setOpen(true)}
      >
        {SHARE_LABEL}
      </button>
      {!open ? null : (
        <div
          className="share-panel"
          data-testid="share-panel"
          role="dialog"
          aria-label={SHARE_LABEL}
        >
          {/* Read-only, and selects everything: this field exists to be copied from. */}
          <input
            ref={field}
            className="share-link-field"
            data-testid="share-link-field"
            type="text"
            readOnly
            value={link}
            aria-label="Board link"
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="share-copy"
            data-testid="copy-link"
            onClick={copyLink}
            aria-describedby="share-status"
          >
            {/* The tick is in the label rather than beside it: the message and the button it
              describes are the same thing, and this way they cannot drift apart. */}
            {copyState === 'copied' ? `${LINK_COPIED_MESSAGE} ✓` : COPY_LINK_LABEL}
          </button>
          <p
            id="share-status"
            className="share-status"
            data-testid="share-status"
            role="status"
            aria-live="polite"
          >
            {copyState === 'manual' ? MANUAL_COPY_MESSAGE : ''}
          </p>
          <p className="share-note" data-testid="share-note">
            {SHARE_NOTE}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * The clipboard, as a function that takes text and puts it there — or `undefined` when this page
 * has no clipboard to put it in.
 *
 * The check is for the method as well as the object: an object with no `writeText` is not a
 * clipboard, and treating it as one is how a page ends up promising a copy it cannot do.
 */
export function clipboardCopy(): ((text: string) => Promise<void>) | undefined {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') return undefined;
  return (text: string) => clipboard.writeText(text);
}

/** Where this page is served from. */
function readOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}
