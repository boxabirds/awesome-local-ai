/**
 * Share panel (`share.copy_link`, `share.copy_fallback`).
 *
 * The link is the whole of story 5's sharing, so the panel's job is to get this
 * exact string onto someone's clipboard, and to be honest when it cannot:
 *
 *   - the link is shown in a readonly field, so it can always be selected and
 *     copied by hand — the fallback is not an error message, it is the same
 *     field that was already there;
 *   - "Copy link" tries `navigator.clipboard.writeText`, and only that. On
 *     success the confirmation says "Link copied" for `LINK_COPIED_MS`; on
 *     failure the panel says the copy failed and selects the text;
 *   - the panel is a `role="dialog"` opened from the Share button: Escape and a
 *     click outside close it, and focus goes back to the Share button, which is
 *     where the person was standing.
 *
 * `boardLink()` is the only source of the string. The panel never assembles an
 * address itself, so what a person copies is what the app would navigate to.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { LINK_COPIED_MS } from "../../shared/config";
import { boardLink } from "../api";

export interface SharePanelProps {
  boardId: string;
  /** Injectable for component tests, which run on a jsdom origin. */
  origin?: string;
  /** Injectable clipboard, so the fallback path is testable without a browser. */
  copy?: (text: string) => Promise<void>;
}

/** The default clipboard write, guarded: this API is absent in many contexts. */
async function copyToClipboard(text: string): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard?.writeText) throw new Error("clipboard unavailable");
  await clipboard.writeText(text);
}

export function SharePanel({ boardId, origin, copy = copyToClipboard }: SharePanelProps) {
  const link = boardLink(boardId, origin);

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearCopiedTimer = useCallback(() => {
    if (copiedTimerRef.current !== undefined) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = undefined;
    }
  }, []);

  // The confirmation is timed, and the timer must not outlive the panel.
  useEffect(() => clearCopiedTimer, [clearCopiedTimer]);

  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    setCopyFailed(false);
    clearCopiedTimer();
    // Focus returns to the button the person pressed, so the board is still
    // usable with the keyboard after sharing.
    shareButtonRef.current?.focus();
  }, [clearCopiedTimer]);

  const openPanel = useCallback(() => {
    setOpen(true);
    setCopyFailed(false);
  }, []);

  // The link is the point of the panel: it is focused and selected the moment the
  // panel exists, so a person can copy it by keyboard, and the manual fallback is
  // one keystroke away if the clipboard refuses.
  useEffect(() => {
    if (!open) return;
    const input = linkInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [open]);

  const copyLink = useCallback(async () => {
    setCopyFailed(false);
    try {
      await copy(link);
      setCopied(true);
      clearCopiedTimer();
      copiedTimerRef.current = setTimeout(() => setCopied(false), LINK_COPIED_MS);
    } catch {
      // The fallback is the visible link, selected: copy it yourself.
      setCopyFailed(true);
      const input = linkInputRef.current;
      input?.focus();
      input?.select();
    }
  }, [clearCopiedTimer, copy, link]);

  // Escape and outside clicks close the panel, but only while it is open.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (shareButtonRef.current?.contains(target)) return;
      close();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [close, open]);

  return (
    <div className="share" data-testid="share">
      <button
        ref={shareButtonRef}
        type="button"
        className="button"
        data-testid="share-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openPanel())}
      >
        Share
      </button>

      {open && (
        <div ref={panelRef} className="share-panel" role="dialog" aria-label="Share board" data-testid="share-panel">
          <label className="share-label" htmlFor="share-link-input">
            Board link
          </label>
          <input
            id="share-link-input"
            ref={linkInputRef}
            className="share-link"
            data-testid="share-link-input"
            value={link}
            readOnly
            aria-label="Board link"
            onFocus={(event) => event.currentTarget.select()}
          />

          <div className="share-actions">
            <button type="button" className="button button-primary" data-testid="copy-link-button" onClick={() => void copyLink()}>
              {copied ? "Link copied \u2713" : "Copy link"}
            </button>
          </div>

          {/* One message at a time: a copy that worked, or the manual fallback. */}
          {copied && (
            <p className="share-status" role="status" data-testid="link-copied" data-duration-ms={LINK_COPIED_MS}>
              Link copied
            </p>
          )}
          {copyFailed && (
            <p className="form-error" role="alert" data-testid="copy-fallback">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </div>
  );
}
