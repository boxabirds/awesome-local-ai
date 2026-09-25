import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDelta, applyTextDiff, clampToLimit, counterVisible } from './StickyText';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  /** The note's live Y.Text; every input is written to it immediately. */
  ytext: Y.Text;
  /** Font size chosen by the note's fit measurement (world px). */
  fontPx: number;
  /** Escape -> 'selected'; pointerdown outside the note -> 'unselected'. */
  onEnd(next: 'selected' | 'unselected'): void;
  /**
   * The tab's undo controller (story 8, undo.boundaries).
   * `boundary()` on mount and on end isolates the typing burst from the
   * surrounding steps; Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y are
   * intercepted so the native textarea history never diverges from Y.Text.
   */
  undo: UndoController;
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
  const { ytext, fontPx, onEnd, undo } = props;
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
    undo.boundary(); // end of the typing session: a later action is a new step
    onEnd(next);
  };

  useEffect(() => {
    // Starting a session is a step boundary (undo.boundaries): the typing
    // burst must never merge with the step that preceded the double-click.
    undo.boundary();
    const ta = textareaRef.current;
    if (!ta) return;
    const text = ytext.toString();
    ta.value = text;
    ta.focus();
    ta.setSelectionRange(text.length, text.length); // caret at the end of the text
    // Remote -> local: absorb another editor's change into the textarea
    // without clobbering the local caret (live.concurrent_text). Local writes
    // are skipped (the textarea is their source of truth). The textarea always
    // equals the doc's text between user actions, so the remote delta (old ->
    // new) applies cleanly to the textarea's current value.
    const onRemoteChange = (event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = textareaRef.current;
      if (!el) return;
      const next = applyTextDelta(el.value, event.delta, el.selectionStart, el.selectionEnd);
      el.value = next.text;
      el.setSelectionRange(next.start, next.end);
    };
    ytext.observe(onRemoteChange);
    return () => {
      ytext.unobserve(onRemoteChange);
    };
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
            return;
          }
          // Undo/redo run against the Y.Text history (story 8): the native
          // textarea history is never touched, so the two can't diverge.
          if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            const key = e.key.toLowerCase();
            if (key === 'z' && !e.shiftKey) {
              e.preventDefault();
              undo.undo();
              return;
            }
            if ((key === 'z' && e.shiftKey) || key === 'y') {
              e.preventDefault();
              undo.redo();
              return;
            }
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
