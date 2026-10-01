// The Share button and the panel behind it.
//
// What this panel has to get right is not the copying, it is the sentence: the link
// *is* the access control (story 14 adds sign-in, not permissions), so the panel
// says in one line what a link can do - "Anyone with this link can view and edit
// this board." A person who copies a link without understanding that has published
// the board, and no dialog later will undo it.
//
// The copy itself has two outcomes and they are not symmetric:
//   - the clipboard took it: say so, for LINK_COPIED_MS, in the button's own place.
//   - the browser refused (permission denied, no clipboard API, or a browser that
//     rejects a write not made from a gesture we can't detect): never say "copied".
//     Select the whole link, focus the field, and say what to press instead. A link
//     that is selected on screen is one the person can copy; a claim that is false
//     is a link that silently never gets sent.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The link of one board: what a person pastes, and what the panel shows. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

/** What the panel shows when the clipboard would not take the link. */
export const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

/** Where the panel is. `copied` and `manual_copy` both mean it is open. */
type PanelState = { kind: 'closed' } | { kind: 'open' } | { kind: 'copied' } | { kind: 'manual_copy' };

const open = (state: PanelState): boolean => state.kind !== 'closed';

export interface SharePanelProps {
  boardId: string;
}

export function SharePanel({ boardId }: SharePanelProps): JSX.Element {
  const [state, setState] = useState<PanelState>({ kind: 'closed' });
  const button = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /** The "Link copied" countdown; one at a time, and never left running. */
  const timer = useRef(0);

  const close = useCallback((): void => {
    window.clearTimeout(timer.current);
    setState({ kind: 'closed' });
    // Focus goes back where the person pressed, so the keyboard does not lose its
    // place when a panel closes itself.
    button.current?.focus();
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const openPanel = useCallback((): void => {
    window.clearTimeout(timer.current);
    setState({ kind: 'open' });
  }, []);

  /** Put the whole link under the person's hand, ready for the copy key. */
  const selectField = useCallback((): void => {
    const input = field.current;
    if (input === null) return;
    // `focus()` first, then `select()`: in Safari a selection in an unfocused field
    // is not visible, and the copy key does nothing without focus either.
    input.focus();
    input.select();
    setState({ kind: 'manual_copy' });
  }, []);

  const copy = useCallback((): void => {
    const link = boardLink(window.location.origin, boardId);
    const clipboard = navigator.clipboard;
    // No clipboard API (an insecure context, an old browser): the answer is the
    // field and the keystroke, not a guess that it worked.
    const write = clipboard?.writeText?.(link);
    if (!write) {
      selectField();
      return;
    }
    write
      .then(() => {
        setState({ kind: 'copied' });
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setState({ kind: 'open' }), LINK_COPIED_MS);
      })
      // A rejected write is the browser saying no: permission, focus, or a page it
      // does not trust. It is not a reason to tell a person the link is copied.
      .catch(() => selectField());
  }, [boardId, selectField]);

  // Escape and a click outside close the panel - the two ways a person says "that's
  // everything" about a small overlay. Both are captured so a note drag in progress
  // underneath cannot stop them.
  useEffect(() => {
    if (!open(state)) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: Event): void => {
      const target = event.target as Node | null;
      if (target !== null && !panel.current?.contains(target) && target !== button.current) close();
    };    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [state, close]);

  const link = boardLink(window.location.origin, boardId);
  const copied = state.kind === 'copied';

  return (
    <>
      <button
        type="button"
        className="share-button"
        data-testid="share-button"
        ref={button}
        onClick={openPanel}
        aria-haspopup="dialog"
        aria-expanded={open(state)}
      >
        Share
      </button>
      {open(state) ? (
        <div
          className="share-panel"
          data-testid="share-panel"
          role="dialog"
          aria-label="Share board"
          ref={panel}
        >          <label className="share-field-label" data-testid="share-field-label" htmlFor="share-link">
            Board link
          </label>
          {/* Read-only, and selecting it on click is the point: a person can take the
              link without the clipboard being involved at all. */}
          <input
            id="share-link"
            className="share-field"
            data-testid="share-field"
            ref={field}
            readOnly
            value={link}
            onClick={(event) => (event.target as HTMLInputElement).select()}
            onFocus={(event) => (event.target as HTMLInputElement).select()}
          />
          <button
            type="button"
            className="share-copy"
            data-testid="share-copy"
            onClick={copy}
            aria-live="polite"
          >
            {copied ? <>{'\u2713'} Link copied</> : 'Copy link'}
          </button>
          {state.kind === 'manual_copy' ? (
            <p className="share-manual" data-testid="share-manual" role="status">
              {MANUAL_COPY_MESSAGE}
            </p>
          ) : null}
          <p className="share-note" data-testid="share-note">
            Anyone with this link can view and edit this board.
          </p>
        </div>
      ) : null}
    </>
  );
}
