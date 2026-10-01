import { useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type CopyState = 'idle' | 'copied' | 'manual';

export function SharePanel({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const rootRef = useRef<HTMLDivElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const link = boardLink(window.location.origin, boardId);

  useEffect(() => () => clearTimeout(timer.current), []);

  const close = () => {
    setOpen(false);
    setCopy('idle');
    clearTimeout(timer.current);
    shareButton.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const manualCopy = () => {
    setCopy('manual');
    input.current?.focus();
    input.current?.select();
  };

  const copyLink = async () => {
    clearTimeout(timer.current);
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(link);
    } catch {
      manualCopy();
      return;
    }
    setCopy('copied');
    timer.current = setTimeout(() => setCopy('idle'), LINK_COPIED_MS);
  };

  return (
    <div className="share" ref={rootRef}>
      <button
        type="button"
        ref={shareButton}
        className="share-button"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Share
      </button>
      {open && (
        <div className="share-panel" role="dialog" aria-label="Share board">
          <input
            ref={input}
            className="share-link"
            readOnly
            value={link}
            aria-label="Board link"
            onClick={(e) => e.currentTarget.select()}
          />
          <button type="button" className="primary-button" onClick={() => void copyLink()}>
            {copy === 'copied' ? (
              <>
                Link copied<span aria-hidden="true"> ✓</span>
              </>
            ) : (
              'Copy link'
            )}
          </button>
          {copy === 'manual' && <p className="share-note">Press Ctrl+C (Cmd+C on Mac) to copy</p>}
          <p className="share-note">Anyone with this link can view and edit this board.</p>
        </div>
      )}
    </div>
  );
}
