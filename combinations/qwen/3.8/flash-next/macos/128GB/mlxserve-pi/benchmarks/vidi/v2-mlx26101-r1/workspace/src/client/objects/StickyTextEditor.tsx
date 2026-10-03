import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  applyTextDelta,
  caretAfterRemoteEdit,
  clampToLimit,
  counterVisible,
  fitFontSize,
  textDelta,
  type TextOp,
} from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note was showing when editing began (starting point). */
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/** The nearest sticky-note ancestor of an element, if any. */
function noteAncestor(el: Element | null): Element | null {
  return el?.closest('[role="group"]') ?? null;
}

/**
 * The textarea shown while a note is being edited. It is the bridge between a
 * plain textarea and the shared Y.Text: every `input` is clamped to the character
 * limit and written to Y.Text as the delta since this box last wrote (see
 * `applyTextDelta`), so story 3's concurrent typing keeps every character.
 * IME composition is deferred to `compositionend` so multibyte input never
 * duplicates characters. Escape ends editing keeping the note selected; a
 * pointerdown outside the note ends editing and deselects. The font auto-fits as
 * text grows, and a fade marks overflow past the smallest readable size.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  /** What this box last wrote to (or read from) the shared text. */
  const baseRef = useRef<string>(ytext.toString());
  // A pending value written to the DOM directly but not yet committed (only used
  // to satisfy the uncontrolled/controlled edge when clamping truncates).
  const [length, setLength] = useState(() => ytext.toString().length);
  const [fit, setFit] = useState({ fontPx, overflow: false });

  // Re-measure the textarea and update font size / overflow from real layout.
  const remeasure = () => {
    const el = ref.current;
    if (!el) return;
    const box = el.clientHeight || el.offsetHeight;
    const result = fitFontSize(el, box);
    setFit((prev) =>
      prev.fontPx === result.fontPx && prev.overflow === result.overflow
        ? prev
        : result,
    );
  };

  /**
   * Show `value` in the box with the caret at `caret`, and remember it as the
   * basis of the next local change.
   */
  const adopt = (value: string, caret: number): void => {
    baseRef.current = value;
    const el = ref.current;
    if (!el) return;
    if (el.value !== value) el.value = value;
    const at = Math.min(Math.max(caret, 0), value.length);
    el.setSelectionRange(at, at);
    setLength(value.length);
    remeasure();
  };

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const next = clampToLimit(el.value);
    const delta = textDelta(baseRef.current, next);
    if (delta.deleteCount === 0 && delta.insert.length === 0) {
      // Nothing changed here; just pick up whatever the other person typed.
      adopt(ytext.toString(), next.length);
      return;
    }
    // Only this box's own change goes to the shared text, wherever that text has
    // got to in the meantime — characters typed by someone else survive.
    const merged = applyTextDelta(ytext, delta, LOCAL_ORIGIN);
    adopt(merged, delta.start + delta.insert.length);
  };

  // Mount: seed the textarea, focus it and place the caret at the end of the text.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    baseRef.current = el.value;
    setLength(el.value.length);
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    remeasure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  // The other person's typing on this note appears while we are editing it too:
  // their change is adopted into the box and the caret is stepped around it.
  useEffect(() => {
    const onRemote = (
      event: Y.YTextEvent,
      transaction: Y.Transaction,
    ): void => {
      if (transaction.origin === LOCAL_ORIGIN) return; // our own write, already adopted
      if (composingRef.current) return; // never disturb an in-flight composition
      const value = ytext.toString();
      const el = ref.current;
      if (el && el.value === value) {
        baseRef.current = value;
        return;
      }
      const caret = el
        ? caretAfterRemoteEdit(
            el.selectionStart ?? value.length,
            event.delta as unknown as readonly TextOp[],
          )
        : value.length;
      adopt(value, caret);
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  // A pointerdown outside this note ends editing and deselects (sticky.edit_end).
  // Registered synchronously: editing is always entered by an event (dblclick,
  // Enter or the create button) whose dispatch has already finished by the time
  // this effect runs, so the effect never observes its own triggering pointerdown.
  useEffect(() => {
    const note = noteAncestor(ref.current);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (note && target && note.contains(target)) return; // inside: keep editing
      commit();
      onEnd('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEnd]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      commit();
      onEnd('selected');
    }
    // Enter inserts a newline (default textarea behaviour); Delete/Backspace edit
    // characters (and never reach the App-level delete handler, which stops
    // propagation-aware).
  };

  const onInput = () => {
    if (composingRef.current) return; // wait for compositionend
    commit();
  };

  const onPointerDownSelf = (e: ReactPointerEvent<HTMLTextAreaElement>) => {
    // Clicking inside the note must neither pan the board nor start a note drag.
    e.stopPropagation();
  };

  const counter = counterVisible(length) ? (
    <span data-testid="sticky-counter" className="sticky-counter">
      {length}/{STICKY_TEXT_MAX_CHARS}
    </span>
  ) : null;

  return (
    <>
      <textarea
        ref={ref}
        data-testid="sticky-note-text"
        className="sticky-text sticky-editing"
        spellCheck={false}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDownSelf}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commit();
        }}
        onBlur={commit}
        style={{ fontSize: `${fit.fontPx}px` }}
        aria-label="Sticky note text"
      />
      {fit.overflow ? (
        <div
          className="sticky-fade"
          data-testid="sticky-overflow-fade"
          aria-hidden="true"
        />
      ) : null}
      {counter}
    </>
  );
}
