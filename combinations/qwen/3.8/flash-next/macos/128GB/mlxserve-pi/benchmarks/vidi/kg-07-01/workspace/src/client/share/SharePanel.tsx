import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export const SHARE_NOTE_TEXT = 'Anyone with this link can view and edit this board.';
export const MANUAL_COPY_TEXT = 'Press Ctrl+C (Cmd+C on Mac) to copy';

/** The full address of a board, ready to paste. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type CopyState = 'idle' | 'copied' | 'manual';

/** Share button (top-right) and its panel: the board link, Copy link, and a manual-copy fallback. */
export function SharePanel(props: { boardId: string }) {
  const link = boardLink(window.location.origin, props.boardId);
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearCopiedTimer = () => {
    clearTimeout(copiedTimer.current);
    copiedTimer.current = undefined;
  };

  /** `refocus`: return focus to the Share button (not after a press elsewhere, which moves focus there itself). */
  const close = useCallback((refocus: boolean) => {
    clearCopiedTimer();
    setOpen(false);
    setCopy('idle');
    if (refocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => clearCopiedTimer, []);

  // The link is ready to copy as soon as the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (panelRef.current?.contains(t) || buttonRef.current?.contains(t))) return;
      close(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  const selectLink = () => inputRef.current?.select();

  const manualCopy = () => {
    clearCopiedTimer();
    setCopy('manual');
    inputRef.current?.focus();
    selectLink();
  };

  const copyLink = async () => {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      manualCopy();
      return;
    }
    try {
      await clipboard.writeText(link);
    } catch {
      manualCopy();
      return;
    }
    clearCopiedTimer();
    setCopy('copied');
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = undefined;
      setCopy('idle');
    }, LINK_COPIED_MS);
  };

  return (
    <div className="share">
      <button
        ref={buttonRef}
        type="button"
        className="share__button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        Share
      </button>
      {open && (
        <div ref={panelRef} className="share__panel" role="dialog" aria-label="Share board">
          <div className="share__row">
            <input
              ref={inputRef}
              className="share__link"
              type="text"
              readOnly
              value={link}
              aria-label="Board link"
              onClick={selectLink}
              onFocus={selectLink}
            />
            <button type="button" className="share__copy" onClick={() => void copyLink()}>
              {copy === 'copied' ? (
                <>
                  <span aria-hidden="true">✓ </span>Link copied
                </>
              ) : (
                'Copy link'
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
