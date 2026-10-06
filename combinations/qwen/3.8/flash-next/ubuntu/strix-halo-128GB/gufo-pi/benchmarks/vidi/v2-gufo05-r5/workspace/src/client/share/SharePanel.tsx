/**
 * Share panel: Share button, dialog with read-only link field, Copy link button,
 * and manual-copy fallback when the clipboard is blocked.
 *
 * State machine: Closed → Open → Copied/ManualCopy → Closed (see design).
 */
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LINK_COPIED_MS } from '../../shared/config';

/** Builds the full board link from origin and board id. */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

export function SharePanel(props: { boardId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, props.boardId);

  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    setManualCopy(false);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    // Return focus to the Share button
    buttonRef.current?.focus();
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    setCopied(false);
    setManualCopy(false);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      if (!navigator.clipboard) {
        throw new Error('clipboard not available');
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setManualCopy(false);
      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, LINK_COPIED_MS);
    } catch {
      // Clipboard failed: select input text and show manual copy message
      setManualCopy(true);
      setCopied(false);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [link]);

  // Close on Escape and outside click
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current && !panelRef.current.contains(target) &&
          buttonRef.current && !buttonRef.current.contains(target)) {
        close();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={buttonRef}
        className="share-button"
        onClick={openPanel}
        aria-label="Share"
      >
        Share
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Share board"
          className="share-panel"
        >
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={link}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            aria-label="Board link"
          />
          <button
            onClick={handleCopy}
            aria-label="Copy link"
          >
            {copied ? '✓ Link copied' : 'Copy link'}
          </button>
          <p className="share-note">Anyone with this link can view and edit this board.</p>
          {manualCopy && (
            <p className="share-manual" role="alert">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </>
  );
}
