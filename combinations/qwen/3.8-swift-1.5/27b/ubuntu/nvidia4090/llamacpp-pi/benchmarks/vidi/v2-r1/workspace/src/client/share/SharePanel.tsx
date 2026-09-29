import { useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '@shared/config';

/** The full board link: `${origin}/b/${id}`. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

type ShareState = 'open' | 'copied' | 'manual_copy';

/**
 * Share panel (share.share_panel): a Share button (top-right) that opens a
 * small dialog with the board's full link in a read-only field and a Copy
 * link button. Copying shows "Link copied" for LINK_COPIED_MS; when the
 * clipboard is blocked or unavailable the field text is selected and a
 * manual-copy hint is shown. The panel closes on Escape and on outside
 * pointerdown, returning focus to the Share button.
 */
export function SharePanel(props: { boardId: string }) {
  const { boardId } = props;
  const [open, setOpen] = useState(false);
  const [shareState, setShareState] = useState<ShareState>('open');
  const [copiedText, setCopiedText] = useState('Link copied');

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  // Clear the "Link copied" timer on unmount.
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const close = () => {
    setOpen(false);
    setShareState('open');
    // Focus returns to the Share button on close.
    buttonRef.current?.focus();
  };

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Outside pointerdown closes the panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current && panelRef.current.contains(target)) return;
      if (buttonRef.current && buttonRef.current.contains(target)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const selectLink = () => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  };

  const handleCopy = async () => {
    // Missing clipboard API → manual copy fallback.
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      selectLink();
      setShareState('manual_copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopiedText('Link copied');
      setShareState('copied');
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        setShareState('open');
      }, LINK_COPIED_MS);
    } catch {
      // Clipboard rejected (permission or insecure context) → manual copy.
      selectLink();
      setShareState('manual_copy');
    }
  };

  const showCopied = shareState === 'copied';

  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 1002 }}>
      <button
        ref={buttonRef}
        data-testid="share-button"
        aria-label="Share"
        onClick={() => {
          setOpen(true);
          setShareState('open');
        }}
        style={{
          fontSize: 14,
          padding: '8px 16px',
          borderRadius: 8,
          border: '1px solid #555',
          background: open ? '#333' : '#222',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        Share
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Share board"
          data-testid="share-panel"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            width: 340,
            padding: 16,
            borderRadius: 8,
            border: '1px solid #555',
            background: '#1c1c1c',
            color: '#fff',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'left',
          }}
        >
          <input
            ref={inputRef}
            data-testid="share-link-input"
            readOnly
            value={link}
            onFocus={selectLink}
            onClick={selectLink}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 13,
              padding: 8,
              borderRadius: 4,
              border: '1px solid #555',
              background: '#111',
              color: '#ddd',
              marginBottom: 8,
            }}
          />
          <button
            data-testid="copy-link"
            onClick={handleCopy}
            style={{
              fontSize: 14,
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: showCopied ? '#2e7d32' : '#4f8cff',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {showCopied ? `✓ ${copiedText}` : 'Copy link'}
          </button>
          {shareState === 'manual_copy' && (
            <p data-testid="manual-copy" style={{ fontSize: 12, color: '#bbb', margin: '8px 0 0' }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p style={{ fontSize: 12, color: '#999', margin: '12px 0 0' }}>
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </div>
  );
}
