import { useCallback, useEffect, useRef, useState } from "react";

import { LINK_COPIED_MS } from "../../shared/config";
import { boardHref } from "../router";

/**
 * The link that opens this board for anybody: an absolute address, because a
 * link pasted into a chat is read on someone else's screen.
 */
export function boardLink(boardId: string): string {
  return new URL(boardHref(boardId), window.location.origin).href;
}

interface Props {
  readonly boardId: string;
}

/**
 * Share panel: the link, and one button that puts it on the clipboard.
 *
 * The clipboard is the one part of sharing this app cannot insist on: a browser
 * refuses it when the page has no focus, when it is served over plain http, or
 * when the person has denied the permission, and a page cannot tell those apart
 * from a bug. So a refused copy is not an error message — the link is already
 * selected in the field above the button and the panel says what to do with it
 * (press Ctrl+C). The board itself is never touched from here.
 */
export function SharePanel({ boardId }: Props) {
  const [open, setOpen] = useState(false);
  /** "Link copied" is showing; it reverts by itself after LINK_COPIED_MS. */
  const [copied, setCopied] = useState(false);
  /** The clipboard refused, or there was no clipboard to ask. */
  const [manualCopy, setManualCopy] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  /** Everything the panel is, trigger included: a click outside it closes. */
  const wrapper = useRef<HTMLDivElement | null>(null);
  const revert = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const link = boardLink(boardId);

  useEffect(
    () => () => {
      clearTimeout(revert.current);
    },
    [],
  );

  /** Closing hands the focus back to whoever opened the panel. */
  const close = useCallback(() => {
    setOpen(false);
    setCopied(false);
    setManualCopy(false);
    clearTimeout(revert.current);
    trigger.current?.focus();
  }, []);

  /** The clipboard said no: put the link in the field's selection instead. */
  const copyByHand = useCallback(() => {
    setManualCopy(true);
    // Focused and selected, so Ctrl+C lands without another click: the whole
    // link is the selection, so nobody has to know that Home then Shift+End
    // exists, and a stray keystroke cannot half-select it.
    field.current?.focus();
    field.current?.select();
  }, []);

  const copy = useCallback(() => {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard?.writeText) {
      copyByHand();
      return;
    }
    clipboard
      .writeText(link)
      .then(() => {
        setCopied(true);
        setManualCopy(false);
        clearTimeout(revert.current);
        // The button goes back to the wording of the action, so it can be used
        // again and never claims a copy that happened longer ago than its word.
        revert.current = setTimeout(() => setCopied(false), LINK_COPIED_MS);
      })
      .catch(() => {
        copyByHand();
      });
  }, [copyByHand, link]);

  // While it is open the panel owns Escape and every click outside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const onPointer = (event: MouseEvent): void => {
      const inside = wrapper.current?.contains(event.target as Node) ?? false;
      if (!inside) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  return (
    <div className="share" ref={wrapper}>
      <button
        type="button"
        ref={trigger}
        className="share-trigger"
        data-testid="share-button"
        onClick={open ? close : () => {
          setOpen(true);
          setCopied(false);
          setManualCopy(false);
        }}
        aria-expanded={open}
      >
        Share
      </button>
      {open && (
        <div className="share-panel" role="dialog" aria-label="Share board" data-testid="share-panel">
          <label className="share-label" htmlFor="share-link">
            Board link
          </label>
          <input
            id="share-link"
            ref={field}
            className="share-link"
            data-testid="share-link"
            readOnly
            value={link}
            // A field that is focused on its own shows its selection: nobody has
            // to select all in a box that holds one thing.
            onFocus={() => field.current?.select()}
          />
          <button type="button" className="share-copy" data-testid="share-copy" onClick={copy}>
            {copied ? "Link copied" : "Copy link"}
          </button>
          <p className="share-note" data-testid="share-note">
            Anyone with this link can view and edit this board.
          </p>
          {manualCopy && (
            <p className="share-manual" data-testid="share-manual">
              Press Ctrl+C (Cmd+C on Mac) to copy
            </p>
          )}
        </div>
      )}
    </div>
  );
}
