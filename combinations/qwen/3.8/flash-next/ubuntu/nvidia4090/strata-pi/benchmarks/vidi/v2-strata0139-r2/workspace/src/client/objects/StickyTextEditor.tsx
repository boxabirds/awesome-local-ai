import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
} from "react";
import type * as Y from "yjs";
import { LOCAL_ORIGIN } from "../../shared/board-model";
import { STICKY_FONT_MAX_PX, STICKY_TEXT_BOX_WORLD, STICKY_TEXT_MAX_CHARS } from "../../shared/config";
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize, textBoxStyle } from "./StickyText";

/**
 * The textarea that edits a note's `Y.Text`.
 *
 * - Uncontrolled: the DOM holds the caret, every `input` is written straight
 *   into Y.Text with a minimal diff, so ending editing needs no extra write
 *   and everything typed so far is already kept.
 * - Escape ends editing (the text stays); a pointerdown outside the note is
 *   handled by `StickyNote`, which unmounts this editor.
 * - Enter inserts a newline (it never leaves the note).
 * - IME composition is committed on `compositionend`, never mid-composition.
 */
export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note is currently displaying; refined here by measuring. */
  fontPx: number;
  onEnd(next: "selected" | "unselected"): void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [size, setSize] = useState<number>(() =>
    Number.isFinite(fontPx) ? fontPx : STICKY_FONT_MAX_PX,
  );
  const [overflow, setOverflow] = useState(false);
  const [length, setLength] = useState(() => ytext.toString().length);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const fit = fitFontSize(el, STICKY_TEXT_BOX_WORLD);
    setSize((previous: number) => (previous === fit.fontPx ? previous : fit.fontPx));
    setOverflow((previous: boolean) => (previous === fit.overflow ? previous : fit.overflow));
  }, []);

  const commit = useCallback(
    (raw: string) => {
      const el = ref.current;
      const next = clampToLimit(raw);
      if (el && next !== raw) {
        // Characters beyond the limit are dropped and the caret goes back to
        // the end of the kept text.
        el.value = next;
        setSelectionEnd(el, next.length);
      }
      setLength(next.length);
      applyTextDiff(ytext, next, LOCAL_ORIGIN);
      measure();
    },
    [ytext, measure],
  );

  // Edit start: focus the note and put the caret at the end of its text.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    setSelectionEnd(el, el.value.length);
    measure();
  }, [measure]);

  const onInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    // Mid-composition keystrokes are not real text yet (IME, e.g. Japanese).
    if (composingRef.current) return;
    commit(event.target.value);
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    commit(event.currentTarget.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onEnd("selected");
      return;
    }
    // Enter adds a line break inside the note.
  };

  const onBlur = () => {
    // Defensive flush: whatever the user typed is already in Y.Text unless an
    // unclosed composition is pending.
    if (composingRef.current) {
      composingRef.current = false;
      const el = ref.current;
      if (el) commit(el.value);
    }
  };

  return (
    <>
      <textarea
        ref={ref}
        className={`sticky-note-text sticky-note-editor${overflow ? " is-overflow" : ""}`}
        data-testid="sticky-note-input"
        data-overflow={overflow ? "true" : "false"}
        aria-label="Sticky note text"
        defaultValue={ytext.toString()}
        style={textBoxStyle({ fontSize: `${size}px` })}
        onChange={onInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      />
      {counterVisible(length) ? (
        <span className="sticky-note-counter" data-testid="sticky-note-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </span>
      ) : null}
    </>
  );
}

function setSelectionEnd(el: HTMLTextAreaElement, end: number): void {
  try {
    el.setSelectionRange(end, end);
  } catch {
    // Some browsers refuse setSelectionRange before the field is rendered.
  }
}
