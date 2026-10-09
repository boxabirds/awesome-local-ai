/**
 * The sticky note text editor (story 2, anchor sticky.text).
 *
 * An uncontrolled textarea that mirrors into the note's `Y.Text` with the
 * minimal diff (`applyTextDiff`) on every input event (IME composition is
 * deferred to `compositionend`, so composed text is never duplicated).
 *
 *  - Mount: value comes from Y.Text, the textarea is focused and the caret
 *    is placed at the end of the text (sticky.edit_start).
 *  - `input`: clamp to STICKY_TEXT_MAX_CHARS (caret restored to the end of
 *    the kept text when truncated), write the diff, refit the font, update
 *    the counter.
 *  - Escape: preventDefault, `onEnd("selected")` — every character typed
 *    was already written, so ending editing performs no extra write
 *    (sticky.edit_end).
 *  - Pointerdown anywhere outside the textarea: `onEnd("unselected")`.
 *  - Enter inserts a new line (default textarea behaviour).
 */
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import * as Y from "yjs";
import {
  LOCAL_ORIGIN,
} from "../../shared/board-model";
import {
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from "../../shared/config";
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
  type FontFit,
} from "./StickyText";

/**
 * `scrollHeight` includes the textarea's padding, so the note's full side
 * length is exactly the "fits" bound (see fitFontSize).
 */
const FIT_BOX = STICKY_SIZE_WORLD;

export function StickyTextEditor(props: {
  ytext: Y.Text;
  /** Font size measured by the note (world units); the editor refits itself as text changes. */
  fontPx: number;
  onEnd(next: "selected" | "unselected"): void;
}): React.JSX.Element {
  const { ytext } = props;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;

  const [fit, setFit] = useState<FontFit>({ fontPx: props.fontPx, overflow: false });
  const [length, setLength] = useState(0);

  /** Clamp, write to Y.Text, refit and update the counter. */
  const writeValue = (raw: string): void => {
    const value = clampToLimit(raw);
    const ta = taRef.current;
    if (ta) {
      if (value !== raw) {
        ta.value = value;
        ta.setSelectionRange(value.length, value.length);
      }
      setFit(fitFontSize(ta, FIT_BOX));
    }
    setLength(value.length);
    applyTextDiff(ytext, value, LOCAL_ORIGIN);
  };

  // Mount: initialise from Y.Text, focus, caret at the end (edit start).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.value = ytext.toString();
    setLength(ta.value.length);
    setFit(fitFontSize(ta, FIT_BOX));
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }, [ytext]);

  // Pointerdown anywhere outside the editor ends editing (unselected).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const ta = taRef.current;
      if (ta && event.target instanceof Node && ta.contains(event.target)) return;
      end("unselected");
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const end = (next: "selected" | "unselected"): void => {
    if (endedRef.current) return;
    endedRef.current = true;
    onEndRef.current(next);
  };

  const onInput = (event: React.FormEvent<HTMLTextAreaElement>): void => {
    if (composingRef.current) return; // handled on compositionend
    writeValue(event.currentTarget.value);
  };

  const onCompositionEnd = (event: React.FormEvent<HTMLTextAreaElement>): void => {
    composingRef.current = false;
    writeValue(event.currentTarget.value);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      end("selected");
    }
    // Enter: default behaviour inserts a new line.
  };

  const onBlur = (): void => {
    // Defensively flush a value still in IME composition (rare: focus left
    // mid-composition). Normal blurs have already been written per input.
    if (composingRef.current) {
      composingRef.current = false;
      const ta = taRef.current;
      if (ta) writeValue(ta.value);
    }
  };

  return (
    <div className="sticky-note__editor" data-testid="sticky-note-editor">
      <textarea
        ref={taRef}
        data-testid="sticky-note-textarea"
        className="sticky-note__textarea"
        style={{ fontSize: `${fit.fontPx}px` }}
        aria-label="Sticky note text"
        spellCheck={false}
        onChange={onInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {fit.overflow && <div className="sticky-note__fade" aria-hidden="true" />}
      {counterVisible(length) && (
        <div className="sticky-note__counter" data-testid="sticky-char-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
