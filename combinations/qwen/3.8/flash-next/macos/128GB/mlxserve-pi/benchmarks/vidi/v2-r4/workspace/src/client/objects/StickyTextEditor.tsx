import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CompositionEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export interface StickyTextEditorProps {
  /** The note's shared text. Every keystroke is already written to it. */
  ytext: Y.Text;
  /** Fitted font size in world units, from the note's measurement. */
  fontPx: number;
  /** Called once when editing ends: Escape keeps the selection, a click away drops it. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The textarea that edits a sticky note.
 *
 * It is deliberately uncontrolled: the DOM holds the caret, this component only
 * copies the value into the `Y.Text` on every `input`. Because each change is
 * written as it happens, ending an edit performs no write at all — the text
 * typed so far is simply kept (`sticky.edit_end`).
 *
 * IME composition is the one input the diff must not see half-finished, so
 * events during composition are skipped and the value is written on
 * `compositionend`.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);

  /** Copies the textarea into the shared text, dropping anything past the limit. */
  const write = useCallback((): void => {
    const el = ref.current;
    if (!el || endedRef.current) return;
    const typed = el.value;
    const kept = clampToLimit(typed);
    if (kept !== typed) {
      // Characters past the limit are not added; the caret goes to the end of
      // the kept text, so typing continues where the paste was cut off.
      const caret = Math.min(el.selectionEnd, kept.length);
      el.value = kept;
      el.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    setLength(el.value.length);
  }, [ytext]);

  // Mount: the note's text, focus and the cursor at the end (`sticky.edit_start`).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const text = ytext.toString();
    if (el.value !== text) el.value = text;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    setLength(el.value.length);
  }, [ytext]);

  const finish = useCallback(
    (next: 'selected' | 'unselected') => {
      if (endedRef.current) return;
      endedRef.current = true;
      onEnd(next);
    },
    [onEnd],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keys typed into a note belong to the note, never to the board shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      finish('selected');
    }
    // Enter keeps the textarea's own behaviour and inserts a new line.
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    void event;
    composingRef.current = false;
    write();
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-text sticky-textarea"
        data-testid="sticky-textarea"
        data-sticky-text-box="true"
        aria-label="Sticky note text"
        spellCheck={false}
        style={{ fontSize: `${fontPx}px` } as CSSProperties}
        onChange={() => {
          if (composingRef.current) return;
          write();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Defensive flush: any value still only in the DOM is written first.
          if (!composingRef.current) write();
          finish('unselected');
        }}
      />
      {counterVisible(length) ? (
        <div className="sticky-counter" data-testid="sticky-counter">
          {length}
          /{STICKY_TEXT_MAX_CHARS}
        </div>
      ) : null}
    </>
  );
}
