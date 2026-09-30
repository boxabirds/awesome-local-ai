import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';
export const SHARE_NOTE = 'Anyone with this link can view and edit this board.';

type PanelState = 'closed' | 'open' | 'copied' | 'manual';

/** The board's full link, ready to paste (share.copy). */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

/** Share button (top-right) and panel: copy the link, or select it for manual copying. */
export function SharePanel(props: { boardId: string }): React.JSX.Element {
  const [state, setState] = useState<PanelState>('closed');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const link = boardLink(window.location.origin, props.boardId);
  const open = state !== 'closed';

  const close = useCallback(() => {
    setState('closed');
    buttonRef.current?.focus();
  }, []);

  // Escape or a press outside the panel closes it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
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

  // "Link copied" shows for LINK_COPIED_MS, then the panel returns to its normal state.
  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState((s) => (s === 'copied' ? 'open' : s)), LINK_COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const selectLink = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
  };

  const copy = async () => {
    const manual = () => {
      setState((s) => (s === 'closed' ? s : 'manual'));
      selectLink();
    };
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      manual();
      return;
    }
    try {
      await clipboard.writeText(link);
      setState((s) => (s === 'closed' ? s : 'copied'));
    } catch {
      manual();
    }
  };

  return (
    <div className="share" ref={rootRef}>
      <button
        type="button"
        className="share-button"
        ref={buttonRef}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setState('open'))}
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
              onClick={(e) => e.currentTarget.select()}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="share-copy" onClick={() => void copy()}>
              {state === 'copied' ? (
                <>
                  <span aria-hidden="true">✓ </span>Link copied
                </>
              ) : (
                'Copy link'
              )}
            </button>
          </div>
          {state === 'manual' && (
            <p className="share-manual" role="status">
              {MANUAL_COPY_MESSAGE}
            </p>
          )}
          <p className="share-note">{SHARE_NOTE}</p>
        </div>
      )}
    </div>
  );
}
