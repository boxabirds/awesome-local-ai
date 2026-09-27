// Share panel (spec: share.share_panel): Closed → Open → Copied (LINK_COPIED_MS)
// → Open, and Open → ManualCopy when the clipboard is unavailable or refuses.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The board link for `origin` and `id` (share.share_panel contract). */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type ShareState = 'closed' | 'open' | 'copied' | 'manual';

export function SharePanel({ boardId }: { boardId: string }) {
  const [state, setState] = useState<ShareState>('closed');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<number | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const clearCopiedTimer = useCallback(() => {
    if (copiedTimer.current !== null) {
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearCopiedTimer();
    setState('closed');
    buttonRef.current?.focus();
  }, [clearCopiedTimer]);

  // Escape closes the panel (and returns focus to the Share button).
  useEffect(() => {
    if (state === 'closed') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, close]);

  // A pointerdown outside the panel (and outside the Share button) closes it.
  useEffect(() => {
    if (state === 'closed') return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      if (target instanceof Node && buttonRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [state, close]);

  useEffect(() => clearCopiedTimer, [clearCopiedTimer]);

  const showManualCopy = useCallback(() => {
    const input = inputRef.current;
    input?.focus();
    input?.select();
    setState('manual');
  }, []);

  const copy = useCallback(() => {
    void (async () => {
      const clipboard = navigator.clipboard;
      if (clipboard === undefined) {
        showManualCopy();
        return;
      }
      try {
        await clipboard.writeText(link);
        setState('copied');
        clearCopiedTimer();
        copiedTimer.current = window.setTimeout(() => setState('open'), LINK_COPIED_MS);
      } catch {
        showManualCopy();
      }
    })();
  }, [link, clearCopiedTimer, showManualCopy]);

  return (
    <div className="share-wrap">
      <button ref={buttonRef} className="share-button" onClick={() => setState('open')}>
        Share
      </button>
      {state !== 'closed' && (
        <div ref={panelRef} className="share-panel" role="dialog" aria-label="Share board">
          <input
            ref={inputRef}
            className="share-link-input"
            readOnly
            value={link}
            aria-label="Board link"
            onPointerDown={(event) => event.preventDefault()}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button className="primary-button" onClick={copy}>
            {state === 'copied' ? (
              <>
                <span className="copied-tick" aria-hidden="true">
                  ✓
                </span>{' '}
                Link copied
              </>
            ) : (
              'Copy link'
            )}
          </button>
          <p className="share-note">Anyone with this link can view and edit this board.</p>
          {state === 'manual' && (
            <p className="share-manual" role="alert">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </div>
  );
}
