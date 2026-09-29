import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The full address of a board: what Copy link puts on the clipboard. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type CopyState = 'idle' | 'copied' | 'manual';

/**
 * Share button (top-right) and its panel: the board link in a read-only field, Copy link, and
 * the access note. When the browser does not allow copying, the link is selected for Ctrl+C.
 */
export function SharePanel(props: { boardId: string }) {
  const link = boardLink(window.location.origin, props.boardId);
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Ignores clipboard answers that arrive after the panel closed or the component unmounted.
  const generation = useRef(0);

  const close = useCallback(() => {
    generation.current += 1;
    clearTimeout(copiedTimer.current);
    setOpen(false);
    setCopy('idle');
    buttonRef.current?.focus();
  }, []);

  useEffect(() => () => {
    generation.current += 1;
    clearTimeout(copiedTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  const selectLink = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(0, input.value.length);
    input.select();
  };

  const onCopy = () => {
    const current = generation.current;
    const manual = () => {
      if (generation.current !== current) return;
      clearTimeout(copiedTimer.current);
      setCopy('manual');
      selectLink();
    };
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) {
      manual();
      return;
    }
    let pending: Promise<void>;
    try {
      pending = clipboard.writeText(link);
    } catch {
      manual();
      return;
    }
    pending.then(() => {
      if (generation.current !== current) return;
      clearTimeout(copiedTimer.current);
      setCopy('copied');
      copiedTimer.current = setTimeout(() => setCopy('idle'), LINK_COPIED_MS);
    }, manual);
  };

  const toggle = () => {
    if (open) close();
    else setOpen(true);
  };

  return (
    <div className="share" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="share-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        Share
      </button>
      {open && (
        <div className="share-panel" role="dialog" aria-label="Share board">
          <div className="share-row">
            <input
              ref={inputRef}
              className="share-link"
              type="text"
              readOnly
              value={link}
              aria-label="Board link"
              onClick={selectLink}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="share-copy" onClick={onCopy}>
              {copy === 'copied' ? (
                <>
                  <span aria-hidden="true">✓ </span>Link copied
                </>
              ) : (
                'Copy link'
              )}
            </button>
          </div>
          {copy === 'manual' && (
            <p className="share-manual" role="status">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p className="share-note">Anyone with this link can view and edit this board.</p>
        </div>
      )}
    </div>
  );
}
