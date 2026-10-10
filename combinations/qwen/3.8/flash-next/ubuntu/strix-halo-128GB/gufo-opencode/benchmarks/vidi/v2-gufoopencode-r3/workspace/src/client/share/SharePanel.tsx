import { useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

// A board link is the origin plus the id path segment (share.open_link).
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

// Share button (top-right) + dialog with the read-only link, a copy action
// and a manual-copy fallback when the clipboard is blocked (share.copy,
// share.copy_fallback). Closes on Escape or an outside pointerdown; focus
// returns to the Share button.
export function SharePanel({ boardId }: { boardId: string }) {
  const link = boardLink(window.location.origin, boardId);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);

  const shareRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearTimer = () => {
    if (copyTimer.current !== undefined) clearTimeout(copyTimer.current);
    copyTimer.current = undefined;
  };

  const close = () => {
    clearTimer();
    setOpen(false);
    setCopied(false);
    setManual(false);
    shareRef.current?.focus();
  };

  const showManual = () => {
    setCopied(false);
    setManual(true);
    // Select the whole link so Ctrl/Cmd+C copies it (PRD field behaviour).
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const copy = async () => {
    if (typeof navigator.clipboard?.writeText !== 'function') {
      showManual();
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setManual(false);
      setCopied(true);
      clearTimer();
      copyTimer.current = setTimeout(() => setCopied(false), LINK_COPIED_MS);
    } catch {
      showManual();
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: Event) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || shareRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  useEffect(() => clearTimer, []);

  const onToggle = () => {
    if (open) {
      close();
    } else {
      clearTimer();
      setCopied(false);
      setManual(false);
      setOpen(true);
    }
  };

  return (
    <div className="share-wrap">
      <button
        type="button"
        ref={shareRef}
        className="share-button"
        onClick={onToggle}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Share
      </button>
      {open && (
        <div className="share-panel" role="dialog" aria-label="Share board" ref={panelRef}>
          <label className="share-field">
            <span className="share-field-label">Board link</span>
            <input
              ref={inputRef}
              className="share-link"
              type="text"
              readOnly
              value={link}
              onClick={(event) => event.currentTarget.select()}
            />
          </label>
          <button type="button" className="share-copy" onClick={copy}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <p className="share-note">Anyone with this link can view and edit this board.</p>
          {manual && (
            <p className="share-manual" role="status">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </div>
  );
}
