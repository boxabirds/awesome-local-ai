import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export const SHARE_NOTE_TEXT = 'Anyone with this link can view and edit this board.';
export const MANUAL_COPY_TEXT = 'Press Ctrl+C (Cmd+C on Mac) to copy';
export const COPY_TEXT = 'Copy link';
export const COPIED_TEXT = 'Link copied';

/** The full address of a board, ready to paste. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

/** Open, Copied and ManualCopy of the design's state diagram; Closed is `open === false`. */
type CopyState = 'idle' | 'copied' | 'manual';

/**
 * Share button (top-right) and its panel: the board link in a read-only field, Copy link, and
 * the interim security note. When the browser refuses clipboard access, the link is selected
 * in the field for a manual copy.
 */
export function SharePanel({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const link = boardLink(window.location.origin, boardId);

  const clearTimer = () => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = undefined;
  };

  const close = useCallback(() => {
    clearTimer();
    setOpen(false);
    setCopy('idle');
    buttonRef.current?.focus();
  }, []);

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!open) return undefined;
    copyButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  const selectLink = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
  };

  const onCopied = () => {
    clearTimer();
    setCopy('copied');
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      setCopy('idle');
    }, LINK_COPIED_MS);
  };

  const onManual = () => {
    clearTimer();
    setCopy('manual');
    selectLink();
  };

  const onCopy = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      onManual();
      return;
    }
    let pending: Promise<void>;
    try {
      pending = clipboard.writeText(link);
    } catch {
      onManual();
      return;
    }
    pending.then(onCopied, onManual);
  };

  return (
    <div className="share" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="share__button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Share
      </button>
      {open && (
        <div className="share__panel" role="dialog" aria-label="Share board">
          <div className="share__row">
            <input
              ref={inputRef}
              className="share__link"
              type="text"
              readOnly
              aria-label="Board link"
              value={link}
              onClick={selectLink}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button ref={copyButtonRef} type="button" className="share__copy" onClick={onCopy}>
              {copy === 'copied' ? (
                <>
                  <span className="share__tick" aria-hidden="true">
                    ✓{' '}
                  </span>
                  {COPIED_TEXT}
                </>
              ) : (
                COPY_TEXT
              )}
            </button>
          </div>
          <p className="share__manual" role="status">
            {copy === 'manual' ? MANUAL_COPY_TEXT : null}
          </p>
          <p className="share__note">{SHARE_NOTE_TEXT}</p>
        </div>
      )}
    </div>
  );
}
