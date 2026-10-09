import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type * as Y from "yjs";
import { LOCAL_ORIGIN } from "../../shared/board-model";
import { STICKY_TEXT_MAX_CHARS } from "../../shared/config";
import { applyTextDiff, clampToLimit, counterVisible } from "./StickyText";

/**
 * The textarea that edits one note.
 *
 * Every `input` event is written straight into the shared Y.Text with a minimal
 * diff, so ending editing writes nothing more and text typed so far is always
 * kept. IME composition is skipped until `compositionend`.
 */
export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Board-unit font size from the note's auto-fit (scales with zoom). */
  fontPx: number;
  onEnd(next: "selected" | "unselected"): void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const [length, setLength] = useState(() => ytext.toString().length);

  /** Writes the textarea value to Y.Text, dropping anything past the limit. */
  const commit = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      el.value = clamped;
      const caret = Math.min(clamped.length, el.selectionStart ?? clamped.length);
      el.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    setLength((prev) => (prev === clamped.length ? prev : clamped.length));
  }, [ytext]);

  // Edit start: value from the document, focus, caret at the end of the text.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const initial = ytext.toString();
    if (el.value !== initial) el.value = initial;
    setLength(initial.length);
    el.focus();
    try {
      el.setSelectionRange(initial.length, initial.length);
    } catch {
      // setSelectionRange is not available on every input type; editing still works.
    }
  }, [ytext]);

  const handleInput = () => {
    if (composingRef.current) return;
    commit();
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    commit();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      // Escape ends editing but keeps the note selected; it must not reach the page.
      event.preventDefault();
      event.stopPropagation();
      commit();
      onEndRef.current("selected");
      return;
    }
    // Enter adds a new line inside the note: leave the default alone.
  };

  const showCounter = counterVisible(length);

  return (
    <div className="sticky-note-editor" data-testid="sticky-note-editor">
      <textarea
        ref={textareaRef}
        className="sticky-note-textarea"
        data-testid="sticky-note-textarea"
        aria-label="Sticky note text"
        defaultValue={ytext.toString()}
        spellCheck={false}
        style={{ fontSize: `${fontPx}px` }}
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Defensive flush: normally every input event already wrote.
          if (!composingRef.current) commit();
        }}
      />
      {showCounter ? (
        <span
          className="sticky-note-counter"
          data-testid="sticky-char-counter"
          role="status"
          aria-live="polite"
        >
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </span>
      ) : null}
    </div>
  );
}
