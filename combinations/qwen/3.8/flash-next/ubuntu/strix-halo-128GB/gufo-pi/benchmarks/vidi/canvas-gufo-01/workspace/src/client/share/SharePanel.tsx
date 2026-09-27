// Share button + panel (story 5). Copy uses the async clipboard API; when that
// is unavailable or denied, the link is left selected in the field with a manual
// copy instruction, so sharing never dead-ends.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

export function SharePanel({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const shareRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const link = boardLink(window.location.origin, boardId);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const close = useCallback((): void => {
    setOpen(false);
    setManual(false);
    shareRef.current?.focus(); // focus returns to the Share button
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || shareRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const copy = useCallback(async (): Promise<void> => {
    let written = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        written = true;
      }
    } catch {
      written = false;
    }
    if (written) {
      setManual(false);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), LINK_COPIED_MS);
      return;
    }
    setManual(true);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [link]);

  return (
    <div className="share-panel">
      <button
        type="button"
        ref={shareRef}
        className="share-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Share
      </button>
      {open ? (
        <div className="share-panel-body" role="dialog" aria-label="Share board" ref={panelRef}>
          <p className="share-note">Anyone with this link can view and edit this board.</p>
          <input
            ref={inputRef}
            className="share-link"
            readOnly
            value={link}
            aria-label="Board link"
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
          <button type="button" className="copy-link-button" onClick={() => void copy()}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          {manual ? (
            <p className="manual-copy" role="status">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          ) : null}
          <button type="button" className="share-close" aria-label="Close" onClick={close}>
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
