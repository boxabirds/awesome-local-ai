// Share panel (story 5, share.share): shows the full board link and copies
// it to the clipboard via the async clipboard API; when that is unavailable
// or denied the panel falls back to manual-copy guidance.

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { LINK_COPIED_MS } from '../shared/config';

export function shareLink(boardId: string): string {
  return `${window.location.origin}/b/${boardId}`;
}

/**
 * Copies `text` via the async clipboard API (share.share_panel). Rejects when
 * the API is missing or writeText is denied, so the panel shows the
 * manual-copy guidance (select the link + "Press Ctrl+C (Cmd+C on Mac)").
 */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText === undefined) {
    throw new Error('clipboard unavailable');
  }
  await navigator.clipboard.writeText(text);
}

export function SharePanel({ boardId, onClose }: { boardId: string; onClose: () => void }): ReactElement {
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const link = shareLink(boardId);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), LINK_COPIED_MS);
    return () => window.clearTimeout(t);
  }, [copied]);

  // TC-25 (share.share_panel): the panel closes on Escape and on a click
  // outside it (plus the × button); focus returns to the Share button.
  const close = useCallback((): void => {
    const btn = document.querySelector<HTMLButtonElement>('[data-testid="share-button"]');
    btn?.focus();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: Event): void => {
      const el = panelRef.current;
      if (el !== null && e.target instanceof Node && !el.contains(e.target)) close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [close]);

  const onCopy = async (): Promise<void> => {
    setManualCopy(false);
    try {
      await copyToClipboard(link);
      setCopied(true);
    } catch {
      // share.share_panel (ManualCopy): select the link, focus it, and tell
      // the user to copy it manually (Ctrl/Cmd+C).
      const input = inputRef.current;
      if (input !== null) {
        input.focus();
        input.select();
      }
      setManualCopy(true);
    }
  };

  useEffect(() => {
    if (!manualCopy) return;
    const input = inputRef.current;
    if (input !== null) {
      input.focus();
      input.select();
    }
  }, [manualCopy]);

  return (
    <div ref={panelRef} className="share-panel" data-testid="share-panel" role="dialog" aria-label="Share board">
      <div className="share-panel-header">
        <span>Share this board</span>
        <button className="share-panel-close" data-testid="share-close" aria-label="Close share panel" onClick={close}>
          ×
        </button>
      </div>
      <div className="share-link-row">
        <input
          ref={inputRef}
          className="share-link"
          data-testid="share-link"
          value={link}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          className="share-copy"
          data-testid="share-copy"
          onClick={onCopy}
          aria-label="Copy board link"
        >
          {copied ? 'Link copied ✓' : 'Copy'}
        </button>
      </div>
      <p className="share-note" data-testid="share-note">Anyone with this link can view and edit this board.</p>
      {copied && (
        <p className="share-copied" data-testid="share-copied">
          Link copied — anyone with it can join.
        </p>
      )}
      {manualCopy && (
        <p className="share-manual-copy" data-testid="share-manual-copy" role="alert">
          Press Ctrl+C (Cmd+C on Mac) to copy.
        </p>
      )}
    </div>
  );
}

export function ShareButton({ onOpen }: { onOpen: () => void }): ReactElement {
  return (
    <button className="share-button" data-testid="share-button" onClick={onOpen}>
      Share
    </button>
  );
}
