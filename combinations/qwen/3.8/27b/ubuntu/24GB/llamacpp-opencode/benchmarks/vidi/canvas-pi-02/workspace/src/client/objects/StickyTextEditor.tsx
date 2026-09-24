import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export interface StickyTextEditorProps {
  /** The note's live Y.Text; every input is written to it immediately. */
  ytext: Y.Text;
  /** Font size chosen by the note's fit measurement (world px). */
  fontPx: number;
  /** Escape -> 'selected'; pointerdown outside the note -> 'unselected'. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * Text editing for one sticky note (the textarea is diffed into Y.Text).
 *
 * - On mount: value from Y.Text, focused, caret at the end (`edit_start`).
 * - On `input` (not during IME composition; flushed on `compositionend`):
 *   clamp to the limit, restore the caret if truncated, then write the
 *   minimal diff. Ending editing therefore performs no extra write: all
 *   typed characters are already in the document.
 * - Escape ends editing with the note still selected. A pointerdown outside
 *   the note (captured on window before focus moves) ends it unselected.
 * - Enter inserts a newline (never intercepted).
 */
export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);

  const syncToYText = (): void => {
    const ta = textareaRef.current;
    if (!ta) return;
    const value = clampToLimit(ta.value);
    if (value !== ta.value) {
      // Characters beyond the limit were dropped: caret goes to the end of the kept text.
      ta.value = value;
      ta.setSelectionRange(value.length, value.length);
    }
    applyTextDiff(ytext, ta.value, LOCAL_ORIGIN);
  };

  const finish = (next: 'selected' | 'unselected'): void => {
    if (endedRef.current) return;
    endedRef.current = true;
    syncToYText(); // defensive flush; inputs are normally already written
    onEnd(next);
  };

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const text = ytext.toString();
    ta.value = text;
    ta.focus();
    ta.setSelectionRange(text.length, text.length); // caret at the end of the text
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="vidi6-sticky__editor">
      <textarea
        ref={textareaRef}
        className="vidi6-sticky__text vidi6-sticky__textarea"
        style={{ fontSize: `${fontPx}px` }}
        aria-label="Sticky note text"
        spellCheck={false}
        wrap="soft"
        onInput={() => {
          if (composingRef.current) return; // IME: flush on compositionend instead
          syncToYText();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          syncToYText();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            finish('selected');
          }
          // Enter is deliberately not intercepted: it inserts a newline.
        }}
        onBlur={() => finish('selected')}
      />
      {counterVisible(ytext.length) && (
        <span className="vidi6-sticky__counter" aria-label={`Character count ${ytext.length} of ${STICKY_TEXT_MAX_CHARS}`}>
          {ytext.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
