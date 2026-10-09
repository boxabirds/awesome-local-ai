import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

// Top-right Share button + panel. Copy uses the async clipboard; when the
// browser refuses (no clipboard, or writeText rejects) the link field is
// selected so the person can copy it by hand, with the matching hint.
export function SharePanel(props: { boardId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, props.boardId);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    };
  }, []);

  const close = useCallback((): void => {
    setOpen(false);
    setCopied(false);
    setManualCopy(false);
    if (copiedTimer.current !== null) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
    shareButtonRef.current?.focus();
  }, []);

  const selectField = useCallback((): void => {
    const input = inputRef.current;
    if (input !== null) {
      input.focus();
      input.select();
    }
  }, []);

  const copyLink = useCallback((): void => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined) {
      setManualCopy(true);
      selectField();
      return;
    }
    void clipboard.writeText(link).then(
      () => {
        setManualCopy(false);
        setCopied(true);
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => {
          setCopied(false);
          copiedTimer.current = null;
        }, LINK_COPIED_MS);
      },
      () => {
        setManualCopy(true);
        selectField();
      }
    );
  }, [link, selectField]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) === true || shareButtonRef.current?.contains(target) === true) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        ref={shareButtonRef}
        data-testid="share-button"
        style={{
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: 30,
          font: '600 14px system-ui, sans-serif',
          color: '#ffffff',
          background: '#2563eb',
          border: 'none',
          borderRadius: 8,
          padding: '8px 18px',
          cursor: 'pointer'
        }}
        onClick={() => setOpen((value) => !value)}
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
            position: 'fixed',
            top: 52,
            right: 12,
            zIndex: 30,
            width: 320,
            background: '#ffffff',
            borderRadius: 10,
            boxShadow: '0 4px 20px rgba(0,0,0,0.22)',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}
        >
          <input
            ref={inputRef}
            data-testid="share-link-input"
            readOnly
            value={link}
            onFocus={selectField}
            onClick={selectField}
            style={{
              font: '400 13px system-ui, sans-serif',
              padding: '8px 10px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              width: '100%',
              boxSizing: 'border-box'
            }}
          />
          <button
            type="button"
            data-testid="copy-link-button"
            style={{
              font: '600 14px system-ui, sans-serif',
              color: '#ffffff',
              background: copied ? '#15803d' : '#2563eb',
              border: 'none',
              borderRadius: 6,
              padding: '8px 14px',
              cursor: 'pointer'
            }}
            onClick={copyLink}
          >
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          {manualCopy && (
            <p data-testid="manual-copy-message" style={{ font: '500 13px system-ui, sans-serif', color: '#b45309', margin: 0 }}>
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
          <p style={{ font: '400 13px system-ui, sans-serif', color: '#4b5563', margin: 0 }}>
            Anyone with this link can view and edit this board.
          </p>
        </div>
      )}
    </>
  );
}
