/**
 * The Share panel (story 5, task 5).
 *
 * A Share button in the board's top-right that opens a small panel: the board's
 * own link in a read-only field, a *Copy link* button, and one line saying what
 * a link actually means here. The states are the PRD's — Closed, Open, Copied,
 * ManualCopy — and the interesting part is *why* ManualCopy exists:
 *
 * `navigator.clipboard` is only available in a secure context, and it can be
 * denied even when it is. Firefox and Safari behave differently from Chromium
 * here, and the harness runs over plain http on 127.0.0.1, where the API is
 * simply absent. A button that quietly does nothing on two of three browsers is
 * worse than no button, so a failed copy selects the whole link and says
 * "Press Ctrl+C (Cmd+C on Mac) to copy" — the link is still one keystroke away
 * from being copied, on every browser, with no permission prompt.
 *
 * The panel also closes on Escape and on a click outside it, and gives focus
 * back to the button it came from, because it behaves like a dialog and people
 * expect it to.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The exact PRD copy. Asserted verbatim in tests, so it lives in one place. */
export const SHARE_TEXT = {
  share: 'Share',
  copy: 'Copy link',
  copied: 'Link copied',
  note: 'Anyone with this link can view and edit this board.',
  manual: 'Press Ctrl+C (Cmd+C on Mac) to copy',
} as const;

/** The clipboard seam. Both halves are optional because either can be missing. */
export interface ClipboardWriter {
  writeText?(text: string): Promise<void>;
  execCommand?(command: string): boolean;
}

/** The panel's shape: closed, open, open-and-copied, open-and-select-instead. */
export type SharePhase = 'closed' | 'open' | 'copied' | 'manual';

export interface SharePanelProps {
  /** The board whose link is being shared. */
  boardId: string;
  /** The full link. Injected so the panel can be tested without a location. */
  link: string;
  /** How long "Link copied" lasts. */
  copiedMs?: number;
  /** Clipboard seam. Defaults to the browser's. */
  clipboard?: ClipboardWriter;
  delay?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearDelay?: (handle: ReturnType<typeof setTimeout>) => void;
  /** Watch what actually reached the clipboard. */
  onCopied?: (text: string) => void;
}

/**
 * Copy `text`, trying the clipboard and then the selection fallback.
 *
 * Returns what worked, so the caller knows whether to celebrate or to fall
 * back. A rejected `writeText` is caught here rather than thrown: a denied
 * clipboard is a normal browser answer, and the panel's job is to cope with it.
 */
export async function copyText(
  text: string,
  clipboard: ClipboardWriter | undefined,
  field: HTMLInputElement | null,
): Promise<'clipboard' | 'selected'> {
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return 'clipboard';
    } catch {
      /* fall through to the selection */
    }
  }
  // Select the field's contents. There is no synchronous clipboard write left
  // once the asynchronous API is unavailable, so the best honest answer is to
  // leave the link selected and say what to press.
  field?.focus();
  field?.select();
  return 'selected';
}

/** Read the browser's clipboard object, if this context has one. */
function browserClipboard(): ClipboardWriter | undefined {
  const clipboard = globalThis.navigator?.clipboard as ClipboardWriter | undefined;
  if (clipboard?.writeText !== undefined) {
    return {
      writeText: (text: string) =>
        clipboard.writeText!(text).then(() => undefined, (error: unknown) => Promise.reject(error)),
    };
  }
  return undefined;
}

/**
 * The Share button and its panel.
 *
 * The link text is rendered in the panel even before anything is copied: the
 * panel is where a person reads the address, not just somewhere to press.
 */
export function SharePanel({
  boardId,
  link,
  copiedMs = LINK_COPIED_MS,
  clipboard = browserClipboard(),
  delay = (callback, ms) => setTimeout(callback, ms),
  clearDelay = (handle) => clearTimeout(handle),
  onCopied,
}: SharePanelProps) {
  const [phase, setPhase] = useState<SharePhase>('closed');
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new board means a new link, and a stale "Link copied" under a different
  // address would be a lie, so the panel closes itself between boards.
  useEffect(() => {
    setPhase('closed');
  }, [boardId]);

  // The confirmation is timed, and leaving the board must not leave a timer
  // that writes to a component that is no longer there.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  /** Close the panel and put focus back where the person started. */
  const close = useCallback(() => {
    if (timer.current !== null) {
      clearDelay(timer.current);
      timer.current = null;
    }
    setPhase('closed');
    buttonRef.current?.focus();
  }, [clearDelay]);

  // Escape closes the panel. The listener is on the document rather than the
  // panel because a person pressing Escape may not be focused inside it.
  useEffect(() => {
    if (phase === 'closed') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // A click anywhere outside the panel and the button closes it. `pointerdown`
    // rather than `click`, so it matches how the rest of the board dismisses
    // things and does not wait for a release.
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [close, phase]);

  const copy = useCallback(async () => {
    if (timer.current !== null) {
      clearDelay(timer.current);
      timer.current = null;
    }
    const how = await copyText(link, clipboard, fieldRef.current);
    if (how === 'selected') {
      setPhase('manual');
      return;
    }
    onCopied?.(link);
    setPhase('copied');
    // The confirmation is on a timer, and it is a *state*, not a CSS trick: a
    // second copy restarts it rather than waiting for the first one to expire.
    timer.current = delay(() => setPhase('open'), copiedMs);
  }, [clipboard, clearDelay, copiedMs, delay, link, onCopied]);

  const open = useCallback(() => {
    setPhase((current) => (current === 'closed' ? 'open' : 'closed'));
  }, []);

  return (
    <div className="share" data-testid="share">
      <button
        ref={buttonRef}
        type="button"
        className="share-trigger"
        data-testid="share-trigger"
        aria-expanded={phase !== 'closed'}
        aria-haspopup="dialog"
        onClick={open}
      >
        {SHARE_TEXT.share}
      </button>
      {phase === 'closed' ? null : (
        <div
          ref={panelRef}
          className="share-panel"
          role="dialog"
          aria-label="Share board"
          data-testid="share-panel"
        >
          <input
            ref={fieldRef}
            readOnly
            value={link}
            aria-label="Board link"
            data-testid="share-link"
            // Clicking the field selects the whole link, which is the PRD's
            // field behaviour and the reason it is an `input` and not text.
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="share-copy"
            data-testid="share-copy"
            onClick={() => void copy()}
          >
            {phase === 'copied' ? SHARE_TEXT.copied : SHARE_TEXT.copy}
          </button>
          <p className="share-note" data-testid="share-note">
            {SHARE_TEXT.note}
          </p>
          {phase === 'manual' ? (
            <p className="share-manual" role="status" data-testid="share-manual">
              {SHARE_TEXT.manual}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}