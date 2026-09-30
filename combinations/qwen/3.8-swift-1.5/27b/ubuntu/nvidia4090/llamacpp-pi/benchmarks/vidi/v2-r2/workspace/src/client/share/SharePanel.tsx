import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** The board link shown in the share panel (story 5, share.copy). */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

const panelButtonStyle: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  right: 12,
  zIndex: 1001,
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 600,
  color: 'white',
  background: '#2563EB',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 56,
  right: 12,
  zIndex: 1001,
  width: 320,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 16,
  background: 'white',
  borderRadius: 12,
  boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
  fontFamily: 'system-ui, sans-serif',
};

const linkInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  fontSize: 13,
  fontFamily: 'ui-monospace, monospace',
  border: '1px solid #CBD5E1',
  borderRadius: 6,
  background: '#F8FAFC',
  color: '#0F172A',
};

const copyButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 600,
  color: 'white',
  background: '#2563EB',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

type PanelView = 'open' | 'copied' | 'manual-copy';

/**
 * Share panel (story 5, share.copy): one button, the board link, a copy
 * action. Clipboard success → "✓ Link copied" for LINK_COPIED_MS;
 * failure or missing API → the link fully selected plus a manual-copy
 * hint. Closes on Escape or outside click, restoring focus to the button.
 */
export function SharePanel({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>('open');
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const close = useCallback(() => {
    setOpen(false);
    setView('open');
    if (copiedTimer.current) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
    shareButtonRef.current?.focus();
  }, []);

  // Focus the link when the panel opens (ready to copy manually).
  useEffect(() => {
    if (open) {
      const input = inputRef.current;
      input?.focus();
      input?.select();
    }
  }, [open]);

  // Close on Escape and on pointer-down outside the panel/button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (shareButtonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  // Clean up the "copied" timer on unmount.
  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const doManualCopy = useCallback(() => {
    setView('manual-copy');
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, []);

  const handleCopy = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      doManualCopy();
      return;
    }
    Promise.resolve(clipboard.writeText(link))
      .then(() => {
        setView('copied');
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => {
          setView('open');
          copiedTimer.current = null;
        }, LINK_COPIED_MS);
      })
      .catch(() => doManualCopy());
  }, [link, doManualCopy]);

  return (
    <>
      <button
        ref={shareButtonRef}
        type="button"
        aria-label="Share"
        aria-expanded={open}
        style={panelButtonStyle}
        onClick={() => {
          setOpen(true);
          setView('open');
        }}
      >
        Share
      </button>
      {open && (
        <div ref={panelRef} role="dialog" aria-label="Share board" style={panelStyle}>
          <input
            ref={inputRef}
            readOnly
            value={link}
            style={linkInputStyle}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            type="button"
            style={copyButtonStyle}
            onClick={() => {
              void handleCopy();
            }}
          >
            {view === 'copied' ? (
              <>
                <span aria-hidden="true">✓ </span>
                Link copied
              </>
            ) : (
              'Copy link'
            )}
          </button>
          {view === 'manual-copy' && (
            <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p style={{ margin: 0, fontSize: 12, color: '#64748B' }}>
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </>
  );
}
