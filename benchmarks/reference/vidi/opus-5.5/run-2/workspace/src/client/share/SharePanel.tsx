/**
 * Share button and panel, top-right (anchor: share.share_panel). States: Closed, Open,
 * Copied (for LINK_COPIED_MS) and ManualCopy (clipboard missing or refused: the link is
 * selected in the field for Ctrl+C / Cmd+C). Closes on Escape or a pointer press outside;
 * focus then returns to the Share button.
 */
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export const SHARE_NOTE = 'Anyone with this link can view and edit this board.';
export const MANUAL_COPY_TEXT = 'Press Ctrl+C (Cmd+C on Mac) to copy';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type CopyState = 'idle' | 'copied' | 'manual';

export function SharePanel(props: { boardId: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const shareButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panelId = useId();
  const link = boardLink(window.location.origin, props.boardId);

  const close = useCallback((returnFocus: boolean) => {
    clearTimeout(copiedTimer.current);
    setOpen(false);
    setCopy('idle');
    if (returnFocus) shareButton.current?.focus();
  }, []);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(true);
    };
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Node | null;
      if (target !== null && (panel.current?.contains(target) || shareButton.current?.contains(target))) return;
      // Focus goes where the person clicked; only keyboard closes return it to Share.
      close(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  const selectLink = () => input.current?.select();

  const manualCopy = () => {
    clearTimeout(copiedTimer.current);
    setCopy('manual');
    input.current?.focus();
    selectLink();
  };

  const onCopy = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      manualCopy();
      return;
    }
    let pending: Promise<void>;
    try {
      pending = clipboard.writeText(link);
    } catch {
      manualCopy();
      return;
    }
    pending.then(
      () => {
        clearTimeout(copiedTimer.current);
        setCopy('copied');
        copiedTimer.current = setTimeout(() => setCopy('idle'), LINK_COPIED_MS);
      },
      () => manualCopy(),
    );
  };

  // The panel is not board space: pointer and wheel input here never reach the board.
  const stop = (e: PointerEvent | WheelEvent) => e.stopPropagation();

  return (
    <div className="share" onPointerDown={stop} onWheel={stop}>
      <button
        ref={shareButton}
        type="button"
        className="share-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        Share
      </button>
      {open && (
        <div ref={panel} id={panelId} className="share-panel" role="dialog" aria-label="Share board">
          <div className="share-row">
            <input
              ref={input}
              className="share-link"
              type="text"
              readOnly
              value={link}
              aria-label="Board link"
              onClick={selectLink}
              onFocus={selectLink}
            />
            <button type="button" className="share-copy" onClick={onCopy} data-state={copy}>
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
              {MANUAL_COPY_TEXT}
            </p>
          )}
          <p className="share-note">{SHARE_NOTE}</p>
        </div>
      )}
    </div>
  );
}
