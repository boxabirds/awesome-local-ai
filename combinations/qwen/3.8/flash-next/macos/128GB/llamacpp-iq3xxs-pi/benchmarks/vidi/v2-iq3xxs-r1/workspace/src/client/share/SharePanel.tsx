import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';
import { boardLink } from '../router';

/**
 * The Share panel (PRD share.share_panel, story 5's only new piece of board UI): the
 * board's own address, and a way to put it on the clipboard.
 *
 * Nothing else about sharing changes, because nothing else about sharing exists:
 * anybody who reaches that address is on the board, since the link is the whole access
 * grant (design "Decision 5"). The panel therefore has to be honest about two things —
 * which address it is showing, and whether the copy actually happened — and it has a
 * plan for the case where the browser will not hand one out a clipboard (TC-23, TC-24).
 */
export interface SharePanelProps {
  readonly boardId: string;
  /** Component tests capture what was offered for copying instead of using a real
   *  clipboard; the browser test (TC-26) reads the real one back. */
  readonly onCopy?: (link: string, copied: boolean) => void;
}

/** The exact strings this panel shows, exported so a test cannot drift from them. */
export const COPY_LABEL = 'Copy link';
export const COPIED_LABEL = 'Link copied';
export const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';
export const ACCESS_NOTE = 'Anyone with this link can view and edit this board.';
export const SHARE_BUTTON_LABEL = 'Share';
export const PANEL_TITLE = 'Share board';

/**
 * Copy `link`, clipboard first and a real selection second, answering whether it
 * worked. Falling back to a selection is not busywork: `navigator.clipboard` is missing
 * on insecure origins and is refused by permission policy and by people who do not
 * want a page reading their clipboard, and in every one of those cases the address is
 * still copyable by hand.
 */
async function copyToClipboard(link: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
      return true;
    }
  } catch {
    // Refused or unavailable: fall through to the selection, which needs no permission.
  }
  try {
    input?.select();
    return document.execCommand('copy');
  } catch {
    return false; // jsdom, and any browser without the (obsolete) command
  }
}

export function SharePanel({ boardId, onCopy }: SharePanelProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A board's address is its only access control, so it is never invented here: the
  // panel shows the address of the board this component was given.
  const link = typeof window === 'undefined' ? boardId : boardLink(window.location.origin, boardId);

  const close = useCallback(() => {
    setOpen(false);
    // Where the person was standing before the panel opened (TC-25).
    buttonRef.current?.focus();
  }, []);

  // Only the copy confirmation has a clock, and it belongs to this open panel.
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  // Closing resets: the label is a confirmation that *this* copy happened, and a
  // panel that remembered it would say "Link copied" to somebody who has not copied
  // anything (TC-31, and PRD share.share_panel).
  useEffect(() => {
    if (open) return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setCopied(false);
    setManual(false);
  }, [open]);

  // Escape and a click anywhere outside close it; the listener never outlives the
  // panel, so a hidden panel cannot swallow keys meant for the board (TC-25).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    // The address is the point of the panel, so it is highlighted as soon as it opens.
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  const copy = useCallback(async () => {
    const ok = await copyToClipboard(link, inputRef.current);
    onCopy?.(link, ok);
    if (!ok) {
      // Nothing could be copied, so say so and leave the address selected: the person
      // can finish the job with the keyboard they already have (TC-23).
      setCopied(false);
      setManual(true);
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    setManual(false);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), LINK_COPIED_MS);
  }, [link, onCopy]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="share-button"
        data-testid="share-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {SHARE_BUTTON_LABEL}
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="share-panel"
          role="dialog"
          aria-label={PANEL_TITLE}
          data-testid="share-panel"
        >
          <div className="share-panel-head">
            <h2>{PANEL_TITLE}</h2>
            <button
              type="button"
              className="share-close"
              data-testid="share-close"
              aria-label="Close"
              onClick={close}
            >
              &times;
            </button>
          </div>
          <input
            ref={inputRef}
            className="share-link"
            data-testid="share-link"
            aria-label="Board link"
            value={link}
            readOnly
            // Clicking selects the whole address, so a keyboard copy needs no dragging.
            onClick={(event) => event.currentTarget.select()}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="share-copy"
            data-testid="share-copy"
            onClick={() => void copy()}
          >
            {copied ? (
              <>
                {/* The tick says it visually; the words say it to a screen reader, and
                    `aria-hidden` keeps the mark out of the button's name. */}
                <span aria-hidden="true">&#10003;</span> {COPIED_LABEL}
              </>
            ) : (
              COPY_LABEL
            )}
          </button>
          {manual ? (
            <p className="share-hint" role="status" data-testid="share-manual">
              {MANUAL_COPY_MESSAGE}
            </p>
          ) : null}
          <p className="share-note">{ACCESS_NOTE}</p>
        </div>
      ) : null}
    </>
  );
}
