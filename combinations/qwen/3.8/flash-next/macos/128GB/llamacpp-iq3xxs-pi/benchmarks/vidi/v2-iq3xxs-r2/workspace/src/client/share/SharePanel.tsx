import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { LINK_COPIED_MS } from '../../shared/config';
import { boardLink } from '../router';

/** Exact UI text (PRD `share.copy`, `share.copy_fallback`, and the security note). */
export const SHARE_BUTTON_LABEL = 'Share';
export const SHARE_PANEL_LABEL = 'Share board';
export const COPY_LINK_LABEL = 'Copy link';
export const LINK_COPIED_LABEL = 'Link copied';
export const COPIED_TICK = '\u2713';
export const SHARE_NOTE = 'Anyone with this link can view and edit this board.';
export const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

/**
 * The panel's four states, from the design's state diagram. `copied` and `manual_copy`
 * are both "the panel is open and something happened when you asked for the link"; the
 * difference is only what the button and the message say, which is why closing works the
 * same from all three.
 */
type SharePanelState =
  | { readonly stage: 'closed' }
  | { readonly stage: 'open' }
  | { readonly stage: 'copied' }
  | { readonly stage: 'manual_copy' };

type SharePanelEvent =
  | { readonly type: 'open' }
  | { readonly type: 'close' }
  | { readonly type: 'copied' }
  | { readonly type: 'manual-copy' }
  /** LINK_COPIED_MS passed: the button goes back to asking, the panel stays open. */
  | { readonly type: 'copied-expired' };

function nextSharePanelState(state: SharePanelState, event: SharePanelEvent): SharePanelState {
  switch (event.type) {
    case 'open':
      return { stage: 'open' };
    case 'close':
      return { stage: 'closed' };
    case 'copied':
      return { stage: 'copied' };
    case 'manual-copy':
      return { stage: 'manual_copy' };
    case 'copied-expired':
      // "Link copied" is a confirmation, not a new screen: it wears off, and the panel
      // you can copy out of is still there.
      return state.stage === 'copied' ? { stage: 'open' } : state;
  }
}

/** The clipboard, if this browser has one that can write. */
function writableClipboard(): Clipboard | null {
  const clipboard = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  return typeof clipboard?.writeText === 'function' ? clipboard : null;
}

/**
 * The Share panel (story 5): one button, and the board's whole link.
 *
 * There is nothing to invite and no membership to add anybody to, so this panel is the
 * entire sharing feature: it puts the link on the clipboard and says so for
 * `LINK_COPIED_MS`. When it cannot — a browser that refuses clipboard writes, or one
 * where the API is missing altogether — it selects the link in the field instead and tells
 * the person to copy it themselves (`share.copy_fallback`), because clipboard permission
 * behaves differently in every engine and the link still has to get out of here.
 *
 * The note under the field is not decoration. Possession of the link is the only access
 * control this product has, so the panel says it in the one place somebody is about to
 * hand the link to somebody else.
 */
export function SharePanel({ boardId }: { boardId: string }): JSX.Element {
  const [state, dispatch] = useReducer(nextSharePanelState, { stage: 'closed' } as SharePanelState);
  const link = boardLink(window.location.origin, boardId);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((): void => {
    dispatch({ type: 'close' });
    // Sharing is a detour from the board: the keyboard goes back where it was.
    buttonRef.current?.focus();
  }, []);

  const openPanel = (): void => dispatch({ type: 'open' });

  // Opening the panel means the keyboard has come with it: the link is selected, which is
  // both what Ctrl+C would want and what the manual-copy fallback needs.
  useEffect(() => {
    // Only when the panel opens: a panel that is already open and gets a new message must
    // not drag the caret back to the start of the link.
    if (state.stage !== 'closed' && document.activeElement !== inputRef.current) selectLink();
  }, [state.stage]);

  // "Link copied" is worn off by the clock, not by another click.
  useEffect(() => {
    if (state.stage !== 'copied') return;
    const timer = setTimeout(() => dispatch({ type: 'copied-expired' }), LINK_COPIED_MS);
    return () => clearTimeout(timer);
  }, [state.stage]);

  /** Selecting the field's contents is the fallback: the link is then one keystroke away. */
  const selectLink = (): void => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  };

  const copy = async (): Promise<void> => {
    const clipboard = writableClipboard();
    if (clipboard === null) {
      // Not a failure to apologise for: this browser simply does not have one.
      selectLink();
      dispatch({ type: 'manual-copy' });
      return;
    }
    try {
      await clipboard.writeText(link);
      dispatch({ type: 'copied' });
    } catch {
      // Refused (a permission prompt answered no, an insecure context, a locked clipboard).
      selectLink();
      dispatch({ type: 'manual-copy' });
    }
  };

  // Escape closes from anywhere in the panel, and a click outside it closes it too —
  // outside meaning anywhere except the panel and the button that opened it, since
  // clicking that button is how you close it as well (and its own click handles that).
  useEffect(() => {
    if (state.stage === 'closed') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    // Capture, so a control that stops propagation cannot accidentally keep the panel open.
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [state.stage, close]);

  // The button is mounted whether the panel is open or not. It could be swapped for the
  // panel, but then closing the panel would mean focusing an element that React has just
  // thrown away, and "the keyboard goes back where it came from" (`share.share_panel`)
  // would quietly stop working.
  const copied = state.stage === 'copied';
  return (
    <>
      <button
        type="button"
        className="vidi6-share-button"
        data-testid="share-button"
        onClick={openPanel}
        aria-haspopup="dialog"
        aria-expanded={state.stage !== 'closed'}
        ref={buttonRef}
      >
        {SHARE_BUTTON_LABEL}
      </button>
      {state.stage === 'closed' ? null : (
        <div
          className="vidi6-share-panel"
          data-testid="share-panel"
          data-stage={state.stage}
          role="dialog"
          aria-label={SHARE_PANEL_LABEL}
          ref={panelRef}
          // A pointer that starts here must never reach the viewport: story 1 taught this
          // file's neighbours to stop propagation, and a panel floating over the board has
          // the same obligation — otherwise the board pans and the selection clears under
          // the very thing somebody is trying to copy out of.
          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => event.stopPropagation()}
          onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => event.stopPropagation()}
          onDoubleClick={(event: ReactPointerEvent<HTMLDivElement>) => event.stopPropagation()}
        >
          <label className="vidi6-share-label" htmlFor="vidi6-share-link">
            {SHARE_PANEL_LABEL}
          </label>
          <input
            id="vidi6-share-link"
            className="vidi6-share-link"
            data-testid="share-link"
            data-board-id={boardId}
            type="text"
            readOnly
            ref={inputRef}
            value={link}
            // Clicking in the field means "I want this text", so it gets all of it.
            onClick={selectLink}
            onFocus={selectLink}
          />
          <button
            type="button"
            className="vidi6-primary-button vidi6-share-copy"
            data-testid="copy-link"
            onClick={() => void copy()}
          >
            {copied && (
              <span className="vidi6-share-tick" aria-hidden="true">
                {COPIED_TICK}
              </span>
            )}
            {copied ? LINK_COPIED_LABEL : COPY_LINK_LABEL}
          </button>
          {state.stage === 'manual_copy' && (
            <p className="vidi6-form-message" role="status" data-testid="manual-copy-message">
              {MANUAL_COPY_MESSAGE}
            </p>
          )}
          <p className="vidi6-share-note" data-testid="share-note">
            {SHARE_NOTE}
          </p>
        </div>
      )}
    </>
  );
}
