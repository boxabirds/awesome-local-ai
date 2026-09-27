import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, CompositionEvent, FocusEvent } from 'react';
import type { Text as YText } from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export interface StickyTextEditorProps {
  ytext: YText;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The editing surface for one note (design "sticky.text"): a transparent
 * textarea the size of the note. The initial text is taken from the Y.Text and
 * the caret is placed at the end (that is the "start editing" behaviour for a
 * double-click or Enter). Every input is written to the Y.Text immediately with
 * a minimal diff, so ending editing needs no extra write — text typed so far is
 * already in the document and cannot be lost on unmount.
 *
 * Escape ends editing keeping the note selected; a click outside (blur) ends
 * editing and deselects. Enter inserts a newline (never intercepted). IME
 * composition is not diffed until `compositionend`, so composing text (e.g.
 * Japanese) is committed exactly once.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const endedRef = useRef(false);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);

  // On mount (and whenever the note being edited changes): seed the textarea,
  // focus it and put the caret at the end of the existing text.
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.value = ytext.toString();
    setLength(el.value.length);
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [ytext]);

  const commit = (value: string): void => {
    const clamped = clampToLimit(value);
    if (clamped.length !== value.length) {
      const el = ref.current;
      if (el !== null) {
        el.value = clamped;
        const end = clamped.length;
        el.setSelectionRange(end, end);
      }
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    setLength(clamped.length);
  };

  const finish = (next: 'selected' | 'unselected'): void => {
    if (endedRef.current) return;
    endedRef.current = true;
    // Defensive flush: any pending value is already committed on each input,
    // and applyTextDiff ignores a no-op, so this never duplicates characters.
    const el = ref.current;
    if (el !== null) applyTextDiff(ytext, clampToLimit(el.value), LOCAL_ORIGIN);
    onEnd(next);
  };

  const onInput = (): void => {
    if (composingRef.current) return;
    const el = ref.current;
    if (el !== null) commit(el.value);
  };

  const onCompositionEnd = (_event: CompositionEvent<HTMLTextAreaElement>): void => {
    composingRef.current = false;
    const el = ref.current;
    if (el !== null) commit(el.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish('selected');
    }
    // Enter is intentionally not handled: the textarea inserts a newline.
  };

  const onBlur = (_event: FocusEvent<HTMLTextAreaElement>): void => {
    if (!composingRef.current) finish('unselected');
  };

  return (
    <div className="sticky-note__editor">
      <textarea
        ref={ref}
        className="sticky-note__input"
        aria-label="Sticky note text"
        style={{ fontSize: `${fontPx}px` }}
        onInput={onInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        spellCheck={false}
      />
      {counterVisible(length) ? (
        <span className="sticky-note__counter" data-testid="sticky-counter" data-visible="true">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </span>
      ) : null}
    </div>
  );
}
