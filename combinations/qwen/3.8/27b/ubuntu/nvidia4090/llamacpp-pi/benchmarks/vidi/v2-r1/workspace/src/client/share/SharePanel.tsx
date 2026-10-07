// Share panel (story 5, share.share_panel, share.copy, share.copy_fallback):
// a Share button in the top-right of every board opens a small panel with the
// board's full link. Copying uses the Clipboard API; when it is missing or
// blocked the link is selected in the field for a manual copy.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The full link for a board: `${origin}/b/${id}`. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type CopyMode = 'idle' | 'copied' | 'manual';

export function SharePanel(props: { boardId: string }): JSX.Element {
  const { boardId } = props;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CopyMode>('idle');
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const link = boardLink(window.location.origin, boardId);

  const clearCopyTimer = useCallback(() => {
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setMode('idle');
    clearCopyTimer();
    // Focus returns to the Share button on close.
    shareButtonRef.current?.focus();
  }, [clearCopyTimer]);

  const openPanel = useCallback(() => {
    setOpen(true);
    setMode('idle');
  }, []);

  // Focus the link field when the panel opens so the link is ready to copy.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Close on a pointerdown outside the panel (the Share button toggles).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current !== null && panelRef.current.contains(target)) return;
      if (shareButtonRef.current !== null && shareButtonRef.current.contains(target)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Clean up the "Link copied" timer on unmount.
  useEffect(() => clearCopyTimer, [clearCopyTimer]);

  // Clicking inside the link field selects the whole link.
  const selectLink = useCallback(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  }, []);

  const copy = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      // Clipboard API missing (share.copy_fallback): select for manual copy.
      setMode('manual');
      selectLink();
      return;
    }
    Promise.resolve(clipboard.writeText(link)).then(
      () => {
        setMode('copied');
        clearCopyTimer();
        copyTimerRef.current = setTimeout(() => {
          copyTimerRef.current = null;
          setMode('idle');
        }, LINK_COPIED_MS);
      },
      () => {
        // writeText rejected (permission) (share.copy_fallback).
        setMode('manual');
        selectLink();
      },
    );
  }, [link, clearCopyTimer, selectLink]);

  return (
    <>
      <button
        ref={shareButtonRef}
        type="button"
        className="share-button"
        onClick={() => (open ? close() : openPanel())}
      >
        Share
      </button>
      {open && (
        <div ref={panelRef} className="share-panel" role="dialog" aria-label="Share board">
          <input
            ref={inputRef}
            className="share-link-input"
            readOnly
            value={link}
            aria-label="Board link"
            onClick={selectLink}
            onFocus={selectLink}
          />
          <button
            type="button"
            className="share-copy-button"
            onClick={copy}
            aria-label={mode === 'copied' ? 'Link copied' : 'Copy link'}
          >
            {mode === 'copied' ? (
              <>
                <span aria-hidden="true">✓ </span>Link copied
              </>
            ) : (
              'Copy link'
            )}
          </button>
          {mode === 'manual' && (
            <p className="share-manual-copy" role="status">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p className="share-note">Anyone with this link can view and edit this board.</p>
        </div>
      )}
    </>
  );
}
