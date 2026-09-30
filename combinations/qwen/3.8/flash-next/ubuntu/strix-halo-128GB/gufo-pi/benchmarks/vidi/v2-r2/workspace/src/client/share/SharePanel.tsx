import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { LINK_COPIED_MS } from '@shared/config';

/** The full shareable link for a board (letters/digits/hyphen/underscore only). */
export function boardLink(origin: string, id: string): string {
  return `${origin}/b/${id}`;
}

/**
 * Share button (top-right) + panel + copy, per the Share panel state diagram
 * (Closed -> Open -> Copied | ManualCopy). Copy writes the full link with the
 * Clipboard API; when it is missing or rejects, the whole link is selected in the
 * read-only field and the manual-copy message is shown (share.copy_fallback).
 * The panel closes on Escape or an outside pointerdown and returns focus to the
 * Share button, which is always mounted so focus can return to it.
 */
export function SharePanel({ boardId }: { boardId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardLink(window.location.origin, boardId);

  const close = useCallback((): void => {
    setOpen(false);
    setCopied(false);
    setManual(false);
    buttonRef.current?.focus();
  }, []);

  // Close on Escape and on a pointerdown outside the panel / Share button.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    const onPointerDown = (e: Event): void => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  // Clear any pending "Link copied" timer on unmount.
  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const openPanel = (): void => {
    setOpen(true);
    setCopied(false);
    setManual(false);
  };

  const copy = async (): Promise<void> => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(link);
      setManual(false);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), LINK_COPIED_MS);
    } catch {
      setCopied(false);
      setManual(true);
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    }
  };

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className="share-button"
        onClick={openPanel}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Share
      </button>
      {open && (
        <div ref={panelRef} role="dialog" aria-label="Share board" className="share-panel">
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={link}
            aria-label="Board link"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button type="button" className="copy-link-button" onClick={copy}>
            {copied ? (
              <>
                <span aria-hidden="true">✓ </span>Link copied
              </>
            ) : (
              'Copy link'
            )}
          </button>
          <p className="share-note">Anyone with this link can edit the board.</p>
          {manual && (
            <p role="status" className="share-manual">
              Your browser blocked automatic copy. Select the link above and press Ctrl+C.
            </p>
          )}
        </div>
      )}
    </>
  );
}
