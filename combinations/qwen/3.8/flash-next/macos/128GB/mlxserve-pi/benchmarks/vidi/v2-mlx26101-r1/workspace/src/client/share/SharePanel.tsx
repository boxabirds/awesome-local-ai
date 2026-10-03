// The Share panel (share.share_panel): a **Share** button in the top-right that opens
// a small panel holding this board's link, and a **Copy link** action that puts that
// link on the clipboard.
//
// The link is built from the current origin, so a board opened at one address is
// shared at that same address — a link is only useful if it points somewhere a person
// can actually reach. Nothing is written to session storage or local storage: the link
// lives in the address bar, in this input, and on the clipboard, and a private window
// behaves the same as a normal one.
//
// Copying uses the async clipboard's `writeText`, which is the API for dropping plain
// text on the clipboard without a text field being focused by hand. When it fails —
// permission refused, no permission at all, a browser without it — the panel does not
// pretend: the link is left *selected in the panel* with the one instruction that still
// works everywhere, "Press Ctrl+C (Cmd+C on Mac) to copy". That fallback is not a
// courtesy: the PRD requires it, because clipboard behaviour differs between browsers.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** What the Copy link button is showing. */
export type CopyState = 'idle' | 'copied' | 'manual';

/** This board's link, as it would be shared. */
export function boardLink(boardId: string): string {
  return `${window.location.origin}/b/${boardId}`;
}

/** The Copy link button's label for a state. The tick is rendered beside it. */
export function copiedLabel(state: CopyState): string {
  if (state === 'copied') return 'Link copied';
  return 'Copy link';
}

/** The message that replaces the button's promise when the clipboard said no. */
export const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

// Whether the panel is open lives beside the component rather than inside it, so the
// document-level Escape / outside-click listeners and `sharePanelOpen()` all read the
// same answer. One board page is on screen at a time, so one answer is enough.
let panelOpen = false;
const openListeners = new Set<() => void>();

/** Is the Share panel open right now? */
export function sharePanelOpen(): boolean {
  return panelOpen;
}

function setPanelOpen(next: boolean): void {
  if (panelOpen === next) return;
  panelOpen = next;
  for (const listener of [...openListeners]) listener();
}

function subscribeOpen(listener: () => void): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

/**
 * Put plain text on the clipboard. Throws when the browser will not do it, which is
 * what the manual-copy path is for.
 */
async function writeClipboard(text: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    throw new Error('the clipboard is not available');
  }
  await clipboard.writeText(text);
}

export interface SharePanelProps {
  boardId: string;
}

export function SharePanel({ boardId }: SharePanelProps): JSX.Element {
  const open = useSyncExternalStore(subscribeOpen, sharePanelOpen, sharePanelOpen);
  const [copy, setCopy] = useState<CopyState>('idle');
  const shareButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const link = boardLink(boardId);

  // The "Link copied" label is a moment, not a mode: it always goes back to
  // "Copy link" after LINK_COPIED_MS so the button is ready for the next person.
  // The panel belongs to this board page: when the page goes away the panel is not
  // "open", so nothing keeps reporting it as such (and no timer stays armed).
  useEffect(
    () => () => {
      if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current);
      setPanelOpen(false);
    },
    [],
  );

  /** Put the link in the input, selected, with the caret in it. */
  const selectLink = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const close = useCallback(() => {
    setPanelOpen(false);
    setCopy('idle');
    // Focus goes back where it came from, so a keyboard user is not left on the body.
    shareButtonRef.current?.focus();
  }, []);

  const copyLink = useCallback(async () => {
    try {
      await writeClipboard(link);
      setCopy('copied');
      if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopy('idle'), LINK_COPIED_MS);
    } catch {
      // The clipboard said no. Say so, and leave the link selected so the keyboard
      // shortcut the user already knows is the next thing they try.
      setCopy('manual');
      selectLink();
    }
  }, [link, selectLink]);

  // Escape closes the panel, and a pointer down anywhere outside it does too — except
  // on the Share button itself, whose own click does the toggling.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (shareButtonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  // Opening the panel puts the focus in it, on the link, already selected: the link is
  // the reason the panel exists, and Cmd/Ctrl+C works immediately.
  useEffect(() => {
    if (!open) return;
    selectLink();
  }, [open, selectLink]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    setPanelOpen(true);
  };

  return (
    <div className="share" data-testid="share" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="share-open"
        data-testid="share-open"
        ref={shareButtonRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        Share
      </button>
      {open ? (
        <div
          className="share-panel"
          data-testid="share-panel"
          role="dialog"
          aria-label="Share board"
          ref={panelRef}
        >
          <label className="share-label" htmlFor="share-link">
            {'Board link'}
          </label>
          <input
            id="share-link"
            className="share-link"
            data-testid="share-link"
            ref={inputRef}
            readOnly
            value={link}
            // Selecting on focus keeps the whole link copyable in one keystroke,
            // and makes a partial selection (a drag inside the field) obvious.
            onFocus={selectLink}
            onClick={selectLink}
          />
          <button
            type="button"
            className="share-copy"
            data-testid="share-copy"
            onClick={() => {
              void copyLink();
            }}
          >
            {copiedLabel(copy)}
            {copy === 'copied' ? (
              <span className="share-tick" aria-hidden="true" data-testid="share-tick">
                {'\u2713'}
              </span>
            ) : null}
          </button>
          {copy === 'manual' ? (
            <p className="share-manual" role="alert" data-testid="share-manual">
              {MANUAL_COPY_MESSAGE}
            </p>
          ) : null}
          <p className="share-note" data-testid="share-note">
            Anyone with this link can view and edit this board.
          </p>
          <button
            type="button"
            className="share-close"
            data-testid="share-close"
            onClick={close}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
