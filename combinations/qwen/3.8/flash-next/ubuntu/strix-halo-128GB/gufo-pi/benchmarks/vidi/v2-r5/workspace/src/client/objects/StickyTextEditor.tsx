import { useEffect, useRef } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from './StickyText';
import { NOTE_LINE_HEIGHT_FACTOR, NOTE_PADDING } from './layout';

export interface StickyTextEditorProps {
  /** The shared text of the note; every committed keystroke goes straight into it. */
  ytext: Y.Text;
  /** Font size (board units) measured for the note, used as the editor's starting size. */
  fontPx: number;
  /** Escape stops editing and keeps the note selected; a press outside drops the selection. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The note's text editor: a plain textarea whose value is diffed into the shared `Y.Text` on
 * every `input` event.
 *
 * Writing on each keystroke (rather than on blur) is what makes "Escape keeps everything typed
 * so far" true — ending an edit performs no write at all — and it lets collaborators watch the
 * text once story 3 ships. Input beyond the character limit is truncated and the caret moves
 * back to the end of what was kept, so pasting 1,200 characters leaves exactly 1,000. IME
 * composition is left to the browser and only the result at `compositionend` is written, so
 * pre-edit text never duplicates characters. Enter is not intercepted: it inserts a new line.
 *
 * A press *outside* the note is detected by `StickyNote` (which owns the note element); the
 * editor's own `blur` only flushes the pending value defensively.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  /** Write a value into the shared text, clamped to the character limit. */
  const commit = (raw: string): void => {
    const kept = clampToLimit(raw);
    const textarea = textareaRef.current;
    if (textarea && kept.length !== raw.length) {
      // Characters beyond the limit are dropped; the caret sits at the end of what was kept.
      textarea.value = kept;
      textarea.setSelectionRange(kept.length, kept.length);
    }
    applyTextDiff(ytext, kept, LOCAL_ORIGIN);
  };

  const flush = (): void => {
    const textarea = textareaRef.current;
    if (textarea) commit(textarea.value);
  };

  // Mount: seed the value from the document, focus, and put the caret at the end of the text.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.value = ytext.toString();
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
    // Intentionally mount-only: from here on the user owns the caret.
  }, [ytext]);

  const handleInput = (event: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    if (composingRef.current) return;
    commit(event.currentTarget.value);
  };

  return (
    <textarea
      ref={textareaRef}
      className="sticky-note-editor"
      data-testid="sticky-note-editor"
      aria-label="Sticky note text"
      spellCheck={false}
      style={{
        fontSize: `${fontPx}px`,
        lineHeight: `${Math.round(fontPx * NOTE_LINE_HEIGHT_FACTOR)}px`,
        padding: `${NOTE_PADDING}px`,
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        commit(event.currentTarget.value);
      }}
      onInput={handleInput}
      onBlur={flush}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          flush();
          onEndRef.current('selected');
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}

/** Shrink the editor's font until its content fits the note, exactly like the display text. */
