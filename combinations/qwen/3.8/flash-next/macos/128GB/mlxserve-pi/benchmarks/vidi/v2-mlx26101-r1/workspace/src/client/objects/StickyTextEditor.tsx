import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
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
 * limit and written to Y.Text with a minimal diff (so story 3's concurrent typing
 * survives). IME composition is deferred to `compositionend` so multibyte input
 * never duplicates characters. Escape ends editing keeping the note selected; a
 * pointerdown outside the note ends editing and deselects. The font auto-fits as
 * text grows, and a fade marks overflow past the smallest readable size.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
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

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      // Drop the over-limit characters and park the caret at the end of kept text.
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    setLength(clamped.length);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    remeasure();
  };

  // Mount: seed the textarea, focus it and place the caret at the end of the text.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    setLength(el.value.length);
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    remeasure();
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
