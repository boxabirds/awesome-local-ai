// Story 5 (share.share_panel): Share button and panel. The link is always
// visible in a selectable field, so copy works even when the clipboard is
// rejected or missing (manual-copy fallback).

import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type CopyState = 'idle' | 'copied' | 'manual';

export function SharePanel({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const clearCopiedTimer = () => {
    if (copiedTimer.current !== null) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
  };

  const close = useCallback(() => {
    setOpen(false);
    setCopy('idle');
    clearCopiedTimer();
    shareButtonRef.current?.focus();
  }, []);

  // Close on Escape and on any pointerdown outside the panel/button.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target) || shareButtonRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  useEffect(() => clearCopiedTimer, []);

  const openPanel = () => {
    setOpen(true);
    setCopy('idle');
  };

  const copyLink = () => {
    const manual = () => {
      setCopy('manual');
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    const clipboard = navigator.clipboard;
    if (!clipboard || !clipboard.writeText) {
      manual();
      return;
    }
    clipboard
      .writeText(link)
      .then(() => {
        setCopy('copied');
        clearCopiedTimer();
        copiedTimer.current = setTimeout(() => setCopy('idle'), LINK_COPIED_MS);
      })
      .catch(manual);
  };

  return (
    <div className="share">
      <button type="button" className="share-button" ref={shareButtonRef} onClick={openPanel}>
        Share
      </button>
      {open && (
        <div className="share-panel" role="dialog" aria-label="Share board" ref={panelRef}>
          <input
            ref={inputRef}
            className="share-link"
            readOnly
            value={link}
            aria-label="Board link"
            onClick={(e) => e.currentTarget.select()}
          />
          <button type="button" className="share-copy" onClick={copyLink}>
            {copy === 'copied' ? (
              <>
                <span aria-hidden="true">✓</span> Link copied
              </>
            ) : (
              'Copy link'
            )}
          </button>
          {copy === 'manual' && (
            <p role="status" className="share-manual">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p className="share-note">Anyone with this link can view and edit this board.</p>
        </div>
      )}
    </div>
  );
}
