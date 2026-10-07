import type * as Y from "yjs";
import { useEffect, useRef, useState } from "react";
import { LOCAL_ORIGIN } from "../../shared/board-model";
import { applyTextDiff, clampToLimit } from "./StickyText";

export interface StickyTextEditorProps {
  /** The shared text of the note being edited. */
  ytext: Y.Text;
  /** Fitted font size in world units (so it scales with board zoom). */
  fontPx: number;
  /** Escape keeps the note selected; a click outside does not. */
  onEnd(next: "selected" | "unselected"): void;
}

/**
 * The textarea that edits a note's text.
 *
 * Every `input` event is written into the shared `Y.Text` immediately (clamped
 * to the character limit), so ending an edit performs no extra write and typed
 * text can never be lost.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const [value, setValue] = useState(() => ytext.toString());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const liveRef = useRef(value);
  liveRef.current = value;

  // sticky.edit_start: focus the note with the caret at the end of its text.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    placeCaretAtEnd(el);
  }, []);

  const commit = (raw: string) => {
    const next = clampToLimit(raw);
    const el = textareaRef.current;
    if (next !== raw && el) {
      // Characters past the limit are dropped, caret goes back to the end.
      el.value = next;
      placeCaretAtEnd(el);
    }
    if (next === liveRef.current) return;
    liveRef.current = next;
    setValue(next);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
  };

  return (
    <textarea
      ref={textareaRef}
      className="sticky-text sticky-textarea"
      data-testid="sticky-editor"
      aria-label="Sticky note text"
      value={value}
      style={{ fontSize: `${fontPx}px` }}
      spellCheck={false}
      onInput={(event) => {
        // IME composition is committed once, on compositionend.
        if (composingRef.current) return;
        commit(event.currentTarget.value);
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        commit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onEnd("selected");
        }
        // Enter deliberately stays the textarea's own behaviour: a new line.
      }}
      onBlur={(event) => {
        // Defensive flush: whatever is in the box is already the note's text.
        if (!composingRef.current) commit(event.currentTarget.value);
      }}
    />
  );
}

function placeCaretAtEnd(el: HTMLTextAreaElement) {
  const end = el.value.length;
  try {
    el.setSelectionRange(end, end);
  } catch {
    // Some browsers refuse setSelectionRange while the element is detached.
  }
}
