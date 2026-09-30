// Share button and panel (share.copy, share.copy_fallback). Possession of the link
// is the only access control, and the panel says so.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type PanelMode = 'open' | 'copied' | 'manual';

export const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

export function SharePanel({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PanelMode>('open');
  const link = boardLink(window.location.origin, boardId);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const noteId = useId();

  const clearTimer = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const close = useCallback(() => {
    clearTimer();
    setOpen(false);
    setMode('open');
    buttonRef.current?.focus();
  }, []);

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (!open) return;
    copyRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (panelRef.current?.contains(target) || buttonRef.current?.contains(target))) return;
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

  const copy = async () => {
    const manual = () => {
      if (!openRef.current) return;
      clearTimer();
      selectLink();
      setMode('manual');
    };
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      manual();
      return;
    }
    try {
      await clipboard.writeText(link);
    } catch {
      manual();
      return;
    }
    if (!openRef.current) return;
    clearTimer();
    setMode('copied');
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setMode('open');
    }, LINK_COPIED_MS);
  };

  return (
    <div className="share">
      <button
        ref={buttonRef}
        type="button"
        className="share-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Share
      </button>
      {open && (
        <div ref={panelRef} className="share-panel" role="dialog" aria-label="Share board" aria-describedby={noteId}>
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
            <button
              ref={copyRef}
              type="button"
              className={`share-copy${mode === 'copied' ? ' is-copied' : ''}`}
              onClick={() => void copy()}
            >
              {mode === 'copied' ? (
                <>
                  <span aria-hidden="true">✓ </span>Link copied
                </>
              ) : (
                'Copy link'
              )}
            </button>
          </div>
          {mode === 'manual' && (
            <p className="share-manual" role="status">
              {MANUAL_COPY_MESSAGE}
            </p>
          )}
          <p className="share-note" id={noteId}>
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </div>
  );
}
