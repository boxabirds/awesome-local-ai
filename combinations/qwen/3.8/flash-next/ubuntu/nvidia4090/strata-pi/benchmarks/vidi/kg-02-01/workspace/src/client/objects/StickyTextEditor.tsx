import { useLayoutEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { STICKY_TEXT_MAX_CHARS } from "../../shared/config";
import { LOCAL_ORIGIN } from "../../shared/board-model";
import { applyTextDiff, clampToLimit, counterVisible } from "./StickyText";

/**
 * The textarea that edits a note's text.
 *
 * It is uncontrolled: the value is seeded from the `Y.Text` on mount, and
 * every `input` is written through `applyTextDiff` straight away. Ending an
 * edit therefore performs no additional write, and nothing typed is lost.
 */

export const STICKY_TEXT_TESTID = "sticky-textarea";
export const STICKY_COUNTER_TESTID = "sticky-counter";

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Fitted font size, in board units (the note layer is scaled by zoom). */
  fontPx: number;
  /** Escape -> "selected"; a pointerdown outside the note -> "unselected". */
  onEnd(next: "selected" | "unselected"): void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);

  // Start editing (sticky.edit_start): value from the document, focus, and the
  // caret at the end of the existing text.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [ytext]);

  const commit = (el: HTMLTextAreaElement) => {
    const raw = el.value;
    const kept = clampToLimit(raw);
    if (kept !== raw) {
      // Characters beyond the limit are never added: the caret returns to the
      // end of what was kept.
      el.value = kept;
      el.setSelectionRange(kept.length, kept.length);
    }
    applyTextDiff(ytext, kept, LOCAL_ORIGIN);
    setLength(kept.length);
  };

  return (
    <>
      <textarea
        ref={textareaRef}
        className="sticky-text sticky-text-editing"
        data-testid={STICKY_TEXT_TESTID}
        aria-label="Sticky note text"
        style={{ fontSize: `${fontPx}px` }}
        onPointerDown={(event) => event.stopPropagation()}
        onInput={(event) => {
          // IME composition is committed on `compositionend` instead, so a
          // composition never writes a half-finished string to the document.
          if (composingRef.current) return;
          commit(event.currentTarget);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          commit(event.currentTarget);
        }}
        onBlur={(event) => {
          if (composingRef.current) return;
          commit(event.currentTarget); // defensive flush
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // Enter inside the textarea inserts a new line; Escape ends editing
          // and must not reach the window handlers.
          event.preventDefault();
          event.stopPropagation();
          onEnd("selected");
        }}
      />
      {counterVisible(length) ? (
        <span className="sticky-counter" data-testid={STICKY_COUNTER_TESTID} aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </span>
      ) : null}
    </>
  );
}
