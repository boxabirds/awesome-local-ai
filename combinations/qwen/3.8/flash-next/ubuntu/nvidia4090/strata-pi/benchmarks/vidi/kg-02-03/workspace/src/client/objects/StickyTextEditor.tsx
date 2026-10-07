import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type * as Y from "yjs";
import { LOCAL_ORIGIN } from "../../shared/board-model";
import { STICKY_TEXT_MAX_CHARS } from "../../shared/config";
import { applyTextDiff, clampToLimit, counterVisible } from "./StickyText";

/**
 * The textarea that edits one sticky note's `Y.Text` (story 2).
 *
 * It is uncontrolled on purpose: every `input` event is written straight into
 * the `Y.Text` with the minimal diff, so finishing editing needs no write at
 * all and all typed text is kept.
 */
export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size in board units, fitted to the note by `fitFontSize`. */
  fontPx: number;
  onEnd(next: "selected" | "unselected"): void;
  /** Called after every local change so the note can re-fit its text. */
  onTextChange?(text: string): void;
}

export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  onTextChange,
}: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);

  // sticky.edit_start: value from the note, focus, caret at the end of the text.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const value = ytext.toString();
    el.value = value;
    el.focus();
    try {
      el.setSelectionRange(value.length, value.length);
    } catch {
      // Some browsers refuse setSelectionRange on a textarea that lost focus.
    }
    setLength(value.length);
  }, [ytext]);

  const write = () => {
    const el = ref.current;
    if (!el) return;

    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      // Characters past the limit are dropped and the caret stays at the end
      // of what was kept.
      const start = Math.min(clamped.length, el.selectionStart ?? clamped.length);
      const end = Math.min(clamped.length, el.selectionEnd ?? clamped.length);
      el.value = clamped;
      el.setSelectionRange(start, end);
    }

    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    setLength(clamped.length);
    onTextChange?.(clamped);
  };

  const onInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    // During IME composition the value is provisional; `compositionend` writes it.
    if (composingRef.current) return;
    event.stopPropagation();
    write();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      // sticky.edit_end: keep the text, stay selected.
      event.preventDefault();
      event.stopPropagation();
      write();
      onEnd("selected");
      return;
    }
    // Enter adds a new line inside the note; Delete/Backspace edit text.
  };

  return (
    <div className="sticky-editor" data-testid="sticky-editor">
      <textarea
        ref={ref}
        className="sticky-text sticky-textarea"
        data-testid="sticky-textarea"
        data-editing="true"
        aria-label="Sticky note text"
        spellCheck
        style={{ fontSize: `${fontPx}px` }}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          write();
        }}
        onBlur={() => {
          if (!composingRef.current) write();
        }}
      />
      {counterVisible(length) ? (
        <span className="sticky-counter" data-testid="sticky-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
    </div>
  );
}
