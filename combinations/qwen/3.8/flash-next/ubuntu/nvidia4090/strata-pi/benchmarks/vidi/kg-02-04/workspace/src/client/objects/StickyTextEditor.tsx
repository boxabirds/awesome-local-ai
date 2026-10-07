import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type * as Y from "yjs";
import {
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from "../../shared/config";
import { LOCAL_ORIGIN } from "../../shared/board-model";
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize } from "./StickyText";

/**
 * The textarea that edits a note's `Y.Text` (sticky.text).
 *
 * Every `input` event is written to the document immediately, so ending
 * editing performs no additional write and no typed character can be lost.
 */
export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note measured for the current text, in world units. */
  fontPx: number;
  onEnd(next: "selected" | "unselected"): void;
}

/** Height available for text inside a note, in world units. */
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const mountedRef = useRef(true);
  /** The value last written to the document. */
  const writtenRef = useRef(ytext.toString());

  const [length, setLength] = useState(writtenRef.current.length);
  const [fit, setFit] = useState({ fontPx, overflow: false });

  const measure = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const next = fitFontSize(el, STICKY_TEXT_BOX_WORLD);
    setFit((prev) => (prev.fontPx === next.fontPx && prev.overflow === next.overflow ? prev : next));
  }, []);

  /** Clamp, write the minimal diff, update the counter and re-fit the text. */
  const commit = useCallback(
    (raw: string) => {
      const value = clampToLimit(raw);
      const el = textareaRef.current;
      if (el && value !== raw) {
        // Characters beyond the limit are never kept; the caret goes back to
        // the end of the text that was kept.
        el.value = value;
        el.setSelectionRange(value.length, value.length);
      }
      if (value !== writtenRef.current) {
        writtenRef.current = value;
        applyTextDiff(ytext, value, LOCAL_ORIGIN);
      }
      if (mountedRef.current) setLength(value.length);
      measure();
    },
    [ytext, measure],
  );

  /** Defensive flush of whatever the textarea holds (blur, unmount, outside click). */
  const flush = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (el.value !== writtenRef.current) commit(el.value);
  }, [commit]);

  // ---- mount: seed the value, focus, caret at the end of the text --------
  useEffect(() => {
    mountedRef.current = true;
    const el = textareaRef.current;
    if (el) {
      const value = ytext.toString();
      writtenRef.current = value;
      el.value = value;
      el.focus();
      el.setSelectionRange(value.length, value.length);
      setLength(value.length);
    }
    measure();
    return () => {
      mountedRef.current = false;
    };
  }, [ytext, measure]);

  // ---- outside pointerdown ends editing (sticky.edit_end) ----------------
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = textareaRef.current;
      if (!el) return;
      const note = el.closest("[data-sticky-note]");
      const target = event.target as Node | null;
      // Clicks inside the note (including the caret) keep the note in edit mode.
      if (note && target && note.contains(target)) return;
      flush();
      onEnd("unselected");
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [flush, onEnd]);

  const onInput = () => {
    // IME composition is handled on compositionend so nothing is written twice.
    if (composingRef.current) return;
    const el = textareaRef.current;
    if (el) commit(el.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      // Escape ends editing and keeps the note selected; the text is already
      // written, so there is nothing else to do.
      event.preventDefault();
      flush();
      onEnd("selected");
      return;
    }
    // Enter adds a new line, Delete and Backspace edit characters: both are
    // left to the textarea, which is why editing never deletes the note.
    event.stopPropagation();
  };

  return (
    <>
      <textarea
        ref={textareaRef}
        className="sticky-text-editor"
        data-testid="sticky-text-editor"
        aria-label="Sticky note text"
        defaultValue={writtenRef.current}
        spellCheck={false}
        style={{ fontSize: `${fit.fontPx}px` }}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          const el = textareaRef.current;
          if (el) commit(el.value);
        }}
        onBlur={() => {
          if (composingRef.current) return;
          flush();
        }}
      />
      {counterVisible(length) ? (
        <span className="sticky-counter" data-testid="sticky-counter">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </span>
      ) : null}
      {fit.overflow ? (
        <div className="sticky-overflow-fade" data-testid="sticky-overflow-fade" aria-hidden="true" />
      ) : null}
    </>
  );
}
