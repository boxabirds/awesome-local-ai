import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type PanelState = 'closed' | 'open' | 'copied' | 'manual';

const buttonStyle = {
  padding: '6px 14px',
  font: '500 14px system-ui, sans-serif',
  border: '1px solid #90A4AE',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
} as const;

export function SharePanel({ boardId }: { boardId: string }) {
  const [state, setState] = useState<PanelState>('closed');
  const rootRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const link = boardLink(window.location.origin, boardId);
  const isOpen = state !== 'closed';

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const close = useCallback(() => {
    clearTimer();
    setState('closed');
    shareRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen, close]);

  const manualCopy = () => {
    clearTimer();
    setState('manual');
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const copy = async () => {
    try {
      if (!navigator.clipboard) return manualCopy();
      await navigator.clipboard.writeText(link);
    } catch {
      return manualCopy();
    }
    clearTimer();
    setState('copied');
    timer.current = setTimeout(() => {
      timer.current = null;
      setState('open');
    }, LINK_COPIED_MS);
  };

  return (
    <div ref={rootRef} style={{ position: 'fixed', top: 12, right: 16, zIndex: 1000, font: '14px system-ui, sans-serif' }}>
      <button
        ref={shareRef}
        type="button"
        style={{ ...buttonStyle, background: '#1565C0', color: '#fff', border: 'none', fontWeight: 600 }}
        onClick={() => (isOpen ? close() : setState('open'))}
      >
        Share
      </button>
      {isOpen && (
        <div
          role="dialog"
          aria-label="Share board"
          style={{
            position: 'absolute',
            top: 40,
            right: 0,
            width: 340,
            padding: 12,
            boxSizing: 'border-box',
            background: '#fff',
            border: '1px solid #CFD8DC',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <input
            ref={inputRef}
            readOnly
            value={link}
            aria-label="Board link"
            onClick={(e) => e.currentTarget.select()}
            style={{ padding: '6px 8px', font: '13px ui-monospace, monospace', border: '1px solid #90A4AE', borderRadius: 6 }}
          />
          <button type="button" onClick={copy} style={buttonStyle}>
            {state === 'copied' ? (
              <>
                <span aria-hidden="true">✓ </span>Link copied
              </>
            ) : (
              'Copy link'
            )}
          </button>
          {state === 'manual' && <span role="status">Press Ctrl+C (Cmd+C on Mac) to copy</span>}
          <span style={{ color: '#546E7A', fontSize: 13 }}>Anyone with this link can view and edit this board.</span>
        </div>
      )}
    </div>
  );
}
