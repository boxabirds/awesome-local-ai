import { useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type CopyState = 'idle' | 'copied' | 'manual';

export function SharePanel({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const shareRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const link = boardLink(window.location.origin, boardId);

  const close = () => {
    setOpen(false);
    setCopy('idle');
    shareRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || shareRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  useEffect(() => {
    if (copy !== 'copied') return undefined;
    const t = setTimeout(() => setCopy('idle'), LINK_COPIED_MS);
    return () => clearTimeout(t);
  }, [copy]);

  const selectLink = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  };

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(link);
      setCopy('copied');
    } catch {
      setCopy('manual');
      selectLink();
    }
  };

  return (
    <div className="share">
      <button
        ref={shareRef}
        type="button"
        className="share-button"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Share
      </button>
      {open && (
        <div ref={panelRef} role="dialog" aria-label="Share board" className="share-panel">
          <input
            ref={inputRef}
            readOnly
            aria-label="Board link"
            value={link}
            onClick={(e) => e.currentTarget.select()}
          />
          <button type="button" className="copy-button" onClick={() => { void copyLink(); }}>
            {copy === 'copied' ? <><span aria-hidden="true">✓ </span>Link copied</> : 'Copy link'}
          </button>
          {copy === 'manual' && <p role="status">Press Ctrl+C (Cmd+C on Mac) to copy</p>}
          <p className="share-note">Anyone with this link can view and edit this board.</p>
        </div>
      )}
    </div>
  );
}
