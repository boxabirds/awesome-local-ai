/**
 * The Share button, and the panel behind it.
 *
 * This is where a board stops being a place a person happens to be and becomes something they can
 * send to somebody. There are two things on the screen and one promise between them: the link, and
 * "Anyone with this link can view and edit this board." The second is not decoration. A link is the
 * whole of this product's access control — there is no account behind it and no permission in front
 * of it — so the panel that hands one out is the place to say plainly what having it gets you, and
 * the person copying it is the one who decides who else gets in.
 *
 * The copying has a fallback, and the fallback is not an afterthought: browsers differ on whether a
 * page may put text on the clipboard, and the ones that refuse are the same ones that would otherwise
 * leave a person staring at a button that appears to do nothing. When writing is refused the link is
 * selected and the panel says what to press instead, so the panel reaches the same end by the longer
 * route rather than failing. A fallback that only works in the browser the author tested is not a
 * fallback.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import { LINK_COPIED_MS } from '../../shared/config';
import { boardPath } from '../router';

/** The link of a board: where this app is running, and the board's address on it. */
export function boardLink(origin: string, id: string): string {
  // The origin and not a hard-coded scheme, because this has to be the address that opens the board.
  // A link written as `https://127.0.0.1:22880/b/…`, which is what a local board is, would be a link
  // that does not work — and a link that does not work, in a product where the link is the access
  // control, is a board nobody can get into.
  return `${origin}${boardPath(id)}`;
}

/** What the panel says when the clipboard would not take the link. */
export const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

/** What the panel says about who the link admits, which is everybody. */
export const ACCESS_NOTE = 'Anyone with this link can view and edit this board.';

/** The panel's four states: shut, open, the link copied, and the link ready to copy by hand. */
type PanelState = { kind: 'closed' } | { kind: 'open' } | { kind: 'copied' } | { kind: 'manual' };

export interface SharePanelProps {
  boardId: string;
}

export function SharePanel({ boardId }: SharePanelProps): JSX.Element {
  const [state, setState] = useState<PanelState>({ kind: 'closed' });
  const shareButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  /** Set when the panel has just been opened and its field has to be given the focus. */
  const focusField = useRef(false);
  /** The green "Link copied" is on a clock, and the clock is cancelled with the panel. */
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);
  const closed = state.kind === 'closed';

  const clearCopiedTimer = useCallback((): void => {
    if (copiedTimer.current === null) return;
    clearTimeout(copiedTimer.current);
    copiedTimer.current = null;
  }, []);

  const close = useCallback((): void => {
    clearCopiedTimer();
    setState({ kind: 'closed' });
    // The focus goes back to the button the person pressed. A dialog that leaves the focus on the
    // page behind it sends the next Tab to the top of the document, and the person who has just
    // closed the panel has to find their way back down to where they were.
    shareButton.current?.focus();
  }, [clearCopiedTimer]);

  const open = useCallback((): void => {
    // The link is ready to copy the moment the panel is up, because this is a panel about copying.
    // The focus is taken in an effect rather than here: until React has rendered the panel there is
    // no field to give it to.
    focusField.current = true;
    setState({ kind: 'open' });
  }, []);

  useEffect(() => {
    if (closed || !focusField.current) return;
    focusField.current = false;
    field.current?.focus();
    field.current?.select();
  }, [closed]);

  /** The link did not reach the clipboard: either it refused, or this browser has none. */
  const selectForManualCopy = useCallback((): void => {
    setState({ kind: 'manual' });
    const input = field.current;
    if (input === null) return;
    input.focus();
    // The selection is the whole of the fallback: with the text selected, the keys the message names
    // finish the job in every browser, permission or no permission.
    input.select();
  }, []);

  const copy = useCallback(async (): Promise<void> => {
    // Read at the moment of the click rather than once at mount: a browser can be without the
    // asynchronous clipboard altogether, and one can have it and refuse this page. Both end in the
    // same place, and neither is something the person can do anything about.
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard?.writeText === undefined) {
      selectForManualCopy();
      return;
    }
    try {
      await clipboard.writeText(link);
    } catch {
      selectForManualCopy();
      return;
    }
    clearCopiedTimer();
    setState({ kind: 'copied' });
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null;
      // Back to the panel, not shut. The person who asked for the link is about to paste it somewhere
      // and a panel that closes itself takes the link, and the field it is written in, away with it.
      setState((current) => (current.kind === 'copied' ? { kind: 'open' } : current));
    }, LINK_COPIED_MS);
  }, [clearCopiedTimer, link, selectForManualCopy]);

  // Escape, and any pointer landing outside the panel, for as long as it is open. Both are on the
  // document because the panel is not what receives them: the key goes to whatever has the focus
  // (which is the link field, on purpose) and the pointer lands on the board behind.
  useEffect(() => {
    if (closed) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panel.current?.contains(target) === true) return;
      // The Share button is outside the panel and is still the panel's own business: pressing it
      // again is the person shutting it, and the button's own handler says so.
      if (shareButton.current?.contains(target) === true) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [closed, close]);

  // Nothing is left ticking when the panel goes away with the board it was opened on.
  useEffect(() => clearCopiedTimer, [clearCopiedTimer]);

  return (
    <div className="share">
      <button
        type="button"
        className="share-button"
        data-testid="share-button"
        ref={shareButton}
        onClick={closed ? open : close}
        aria-expanded={!closed}
        aria-haspopup="dialog"
      >
        Share
      </button>

      {closed ? null : (
        <div
          className="share-panel"
          data-testid="share-panel"
          data-state={state.kind}
          ref={panel}
          role="dialog"
          aria-label="Share board"
        >
          <label className="share-panel__label" htmlFor={`share-link-${boardId}`}>
            Board link
          </label>
          <input
            className="share-panel__field"
            data-testid="share-link"
            id={`share-link-${boardId}`}
            ref={field}
            type="text"
            readOnly
            value={link}
            aria-label="Board link"
            // The whole link, or nothing. A field whose text can be partly selected is a field from
            // which a person copies half an address and wonders why it does not open.
            onClick={() => {
              field.current?.select();
            }}
            onFocus={() => {
              field.current?.select();
            }}
          />
          <button
            type="button"
            className="share-panel__copy"
            data-testid="share-copy"
            onClick={() => {
              void copy();
            }}
          >
            {state.kind === 'copied' ? (
              <>
                {/* The tick is reassurance, not part of what is read out: the button's words are the
                    ones the product promises it will say. */}
                <span className="share-panel__tick" aria-hidden="true">
                  ✓
                </span>{' '}
                Link copied
              </>
            ) : (
              'Copy link'
            )}
          </button>
          <p className="share-panel__note" data-testid="share-note">
            {ACCESS_NOTE}
          </p>
          {state.kind === 'manual' ? (
            // A polite live region, because this message appears in a panel the person is looking at
            // and says why the button they just pressed did not appear to work.
            <p className="share-panel__manual" data-testid="share-manual" role="status">
              {MANUAL_COPY_MESSAGE}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
