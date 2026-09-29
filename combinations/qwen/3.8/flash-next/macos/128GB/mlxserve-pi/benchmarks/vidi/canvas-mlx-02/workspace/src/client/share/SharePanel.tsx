// The Share panel: the board's own address, in a box, with one button that puts
// it on the clipboard.
//
// Three things about this are not polish.
//
// A link is the only thing that keeps a board private until permissions exist, so
// a visitor who copied what they thought was the link must not be shown a checkmark
// over a link that never went anywhere: the address is read at the moment of the
// copy, the copy is awaited, and only then does the panel say it worked.
//
// A clipboard that refuses - which is what a browser does when the page is not
// focused, whatever the reason - still leaves the visitor with the address they can
// take themselves, which is why the text is never disabled and is always selectable.
//
// And nothing a visitor was told outlives the thing it was said about: closing the
// panel, opening it again, or being shown a different board in it each start again
// with nothing claimed, because a stale "copied" is a lie about a board.
import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config.ts';
import { boardPath } from '../router.ts';
import type { ConnectionState } from '../collab/connectBoard.ts';

export interface SharePanelProps {
  /** The board this panel is about; its address is what gets shared. */
  boardId: string;
  /** A board the server cannot read has nothing worth copying yet (story 4). */
  connectionState?: ConnectionState;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The address that gets copied. Production reads the address bar. */
  getShareUrl?: () => string;
  /** What "copy" means. Production is the system clipboard. */
  copy?: (text: string) => Promise<void>;
}

/** What the visitor was last told about copying. Nothing older than that. */
export type CopyFeedback = 'idle' | 'copying' | 'copied' | 'manual';

/**
 * The one line the panel says about a copy. Success is not said here - the button
 * itself says it, so a visitor who copied sees the answer where their pointer was
 * (PRD share.copy_link). What the panel does have to say is the manual way out of a
 * clipboard that refused.
 */
export function copyFeedbackMessage(feedback: CopyFeedback): string | null {
  switch (feedback) {
    case 'idle':
    case 'copying':
    case 'copied':
      return null;
    case 'manual':
      return 'Press Ctrl+C (Cmd+C on Mac) to copy';
  }
}

const COPY_LABELS: Record<CopyFeedback, string> = {
  idle: 'Copy link',
  copying: 'Copying…',
  copied: 'Link copied',
  manual: 'Copy link',
};

// What the panel says the link is worth to whoever gets it. The link is the whole
// of this product's access control until permissions exist, so it is said plainly.
const LINK_NOTE = 'Anyone with this link can view and edit this board.';

export function SharePanel({
  boardId,
  connectionState,
  open: openProp,
  onOpenChange,
  getShareUrl,
  copy,
}: SharePanelProps) {
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenInternal(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  const root = useRef<HTMLDivElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const linkField = useRef<HTMLInputElement | null>(null);

  const [feedback, setFeedback] = useState<CopyFeedback>('idle');
  // The wait that clears a "copied", and the press whose clipboard write has not
  // answered yet. Both are refs because they describe work in flight, which a
  // re-render must neither duplicate nor lose.
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copying = useRef(false);
  // Which panel this is, for the copy that is in flight: shut the panel or show it
  // another board mid-copy and the answer that arrives afterwards belongs to a
  // panel that no longer exists, and must not be drawn on the one that does.
  const generation = useRef(0);

  const clearTimerIfNeeded = useCallback(() => {
    if (clearTimer.current !== null) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
  }, []);

  // A different code in this panel is a different board with nothing copied.
  useEffect(() => {
    generation.current += 1;
    copying.current = false;
    setFeedback('idle');
    clearTimerIfNeeded();
    return clearTimerIfNeeded;
  }, [boardId, clearTimerIfNeeded]);

  // Shut, and what was said is gone: a "copied" that outlived being shut would be
  // the panel claiming a link went somewhere on an out-of-date copy, and it would
  // be the only thing in the panel a visitor could not re-cause.
  useEffect(() => {
    if (!open) {
      generation.current += 1;
      copying.current = false;
      setFeedback('idle');
      clearTimerIfNeeded();
    }
    return clearTimerIfNeeded;
  }, [open, clearTimerIfNeeded]);

  // Shut the panel and take the pointer back to where it was. A panel that closed
  // itself somewhere else on the page would leave the visitor looking for the button
  // that opens it again.
  const close = useCallback(() => {
    setOpen(false);
    toggle.current?.focus();
  }, [setOpen]);

  // The panel is dismissed, not navigated away from: Escape and a click anywhere
  // outside it close it (PRD share.copy_link, Behaviour).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A note being edited owns Escape: that key is how the note finishes.
      if ((event.target as HTMLElement | null)?.closest?.('.sticky-editor')) return;
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  // A clipboard that refused is answered by putting the text where the visitor can
  // take it with their own keystroke: selected, focused, ready for Ctrl+C.
  useEffect(() => {
    if (feedback === 'manual') {
      linkField.current?.focus();
      linkField.current?.select();
    }
  }, [feedback]);

  // The default address is read from the address bar when it is asked for, not
  // remembered from when the panel opened. It is built from the board this panel
  // is about, which is the same check the copy below makes against it.
  const ownShareUrl = useCallback(() => `${location.origin}${boardPath(boardId)}`, [boardId]);
  const shareUrl = getShareUrl ?? ownShareUrl;

  const onCopy = useCallback(async () => {
    if (copying.current) return;
    const writeText = copy ?? defaultClipboard;
    const url = shareUrl();
    // Is this the link of the board this panel is about? A panel that copied some
    // other address than the one it shows is the story's central failure, so the
    // address being copied is checked here, at the moment it is copied.
    if (!url.endsWith(boardPath(boardId))) return;

    copying.current = true;
    const mine = generation.current;
    const stillMine = () => generation.current === mine;
    setFeedback('copying');
    try {
      await writeText(url);
      if (!stillMine()) return;
      // Only after the write resolved, and never two messages at once.
      setFeedback('copied');
      clearTimerIfNeeded();
      clearTimer.current = setTimeout(() => {
        clearTimer.current = null;
        setFeedback((current) => (current === 'copied' ? 'idle' : current));
      }, LINK_COPIED_MS);
    } catch {
      if (!stillMine()) return;
      // The address stays on screen and is handed over selected and focused, with the
      // instruction to take it by hand. There is no other door to a board than this
      // link.
      setFeedback('manual');
    } finally {
      copying.current = false;
    }
  }, [boardId, copy, clearTimerIfNeeded, shareUrl]);

  const unloadable = connectionState === 'load_failed';
  const message = copyFeedbackMessage(feedback);

  return (
    <div className="share-panel-root" ref={root}>
      <button
        type="button"
        className="share-toggle"
        data-testid="share-button"
        ref={toggle}
        aria-expanded={open}
        aria-controls="share-panel"
        disabled={unloadable}
        onClick={() => setOpen(!open)}
      >
        Share
      </button>

      {open ? (
        <div
          className="share-panel"
          id="share-panel"
          data-testid="share-panel"
          role="dialog"
          aria-label="Share board"
        >
          <label className="share-label" htmlFor="share-link">
            Board link
          </label>
          <input
            id="share-link"
            className="share-link"
            data-testid="share-url-text"
            ref={linkField}
            readOnly
            value={shareUrl()}
            onFocus={(event) => event.currentTarget.select()}
          />

          <p className="share-note" data-testid="share-note">
            {LINK_NOTE}
          </p>

          {unloadable ? (
            <p className="share-disabled-note" data-testid="share-disabled-note">
              The board could not be loaded, so there is nothing to copy yet.
            </p>
          ) : (
            <button
              type="button"
              className="share-copy"
              data-testid="copy-link-button"
              onClick={() => void onCopy()}
              disabled={feedback === 'copying'}
              data-copied={feedback === 'copied' ? 'true' : undefined}
            >
              {COPY_LABELS[feedback]}
            </button>
          )}

          <div
            className="share-slot"
            role="status"
            aria-live="polite"
            data-testid="copy-slot"
          >
            {message ? (
              <p className="share-message" role="alert" data-testid="copy-message">
                {message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

async function defaultClipboard(text: string): Promise<void> {
  if (!navigator.clipboard) throw new Error('this browser has no clipboard');
  await navigator.clipboard.writeText(text);
}
