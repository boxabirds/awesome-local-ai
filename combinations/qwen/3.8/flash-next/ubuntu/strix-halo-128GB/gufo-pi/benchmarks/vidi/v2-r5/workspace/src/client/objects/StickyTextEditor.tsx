import { useEffect, useRef } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit } from './StickyText';
import { NOTE_LINE_HEIGHT_FACTOR, NOTE_PADDING } from './layout';
import type { UndoController } from '../board/undo';

export interface StickyTextEditorProps {
  /** The shared text of the note; every committed keystroke goes straight into it. */
  ytext: Y.Text;
  /** Font size (board units) measured for the note, used as the editor's starting value. */
  fontPx: number;
  /** Escape stops editing and keeps the note selected; a press outside drops the selection. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Undo controller for boundary calls and in-editor undo/redo. */
  undoController?: UndoController;
}

/**
 * The note's text editor: a plain textarea that uses LOCAL diffing to avoid overwriting
 * remote changes during concurrent editing.
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
 *
 * CONCURRENT EDITING: we store the last textarea value and on each input compute only the
 * LOCAL diff (prevTextarea → currTextarea), applying it directly to the YText via insert/delete.
 * This prevents overwriting remote characters that appeared between keystrokes.
 *
 * UNDO: boundary() is called on mount (edit start) and on unmount/end (edit end), so typing
 * within one editing session is grouped by capture timeout but never merges with actions
 * before or after the edit. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z are intercepted inside the
 * textarea and routed to the UndoController so the Y.Text undo is consistent.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd, undoController }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const undoRef = useRef(undoController);
  undoRef.current = undoController;
  // Tracks the textarea value at the last commit so we can compute local-only diffs.
  const prevValueRef = useRef<string>('');

  /**
   * Compute the local change (from prevValue to newValue) and apply it to the YText.
   * This avoids the "full diff" problem where remote changes get overwritten.
   */
  const commit = (raw: string): void => {
    const kept = clampToLimit(raw);
    const textarea = textareaRef.current;
    if (textarea && kept.length !== raw.length) {
      textarea.value = kept;
      textarea.setSelectionRange(kept.length, kept.length);
    }

    // Compute local diff: what the user changed between last commit and now.
    const prev = prevValueRef.current;
    if (prev !== kept) {
      // Find common prefix
      let start = 0;
      const prevArr = Array.from(prev);
      const nextArr = Array.from(kept);
      while (start < prevArr.length && start < nextArr.length && prevArr[start] === nextArr[start]) {
        start++;
      }
      // Find common suffix
      let endPrev = prevArr.length;
      let endNext = nextArr.length;
      while (endPrev > start && endNext > start && prevArr[endPrev - 1] === nextArr[endNext - 1]) {
        endPrev--;
        endNext--;
      }
      const deletedLen = endPrev - start; // code points removed
      const insertedStr = nextArr.slice(start, endNext).join(''); // code points added

      ytext.doc?.transact(() => {
        if (deletedLen > 0) ytext.delete(start, deletedLen);
        if (insertedStr.length > 0) ytext.insert(start, insertedStr);
      }, LOCAL_ORIGIN);

      prevValueRef.current = kept;
    }
  };

  const flush = (): void => {
    const textarea = textareaRef.current;
    if (textarea) commit(textarea.value);
  };

  // Mount: seed the value from the document, focus, put caret at end, call boundary (edit start).
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const initial = ytext.toString();
    textarea.value = initial;
    prevValueRef.current = initial;
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);

    // Boundary at edit start: prevents merging with prior actions
    undoRef.current?.boundary();

    // Intentionally mount-only: from here on the user owns the caret.
  }, [ytext]);

  // Unmount: boundary (edit end)
  useEffect(() => {
    return () => {
      undoRef.current?.boundary();
    };
  }, []);

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
        const key = event.key.toLowerCase();
        // Ctrl/Cmd+Z: undo typing (intercept native textarea undo)
        if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          // Sync textarea value from Y.Text after undo
          const ctrl = undoRef.current;
          if (ctrl) {
            ctrl.undo();
            // Update textarea to reflect undo
            if (textareaRef.current) {
              const newText = ytext.toString();
              textareaRef.current.value = newText;
              prevValueRef.current = newText;
              const pos = Math.min(newText.length, textareaRef.current.selectionStart);
              textareaRef.current.setSelectionRange(pos, pos);
            }
          }
          return;
        }

        // Ctrl/Cmd+Shift+Z or Ctrl+Y: redo typing
        if (
          ((event.ctrlKey || event.metaKey) && key === 'z' && event.shiftKey) ||
          (event.ctrlKey && !event.metaKey && key === 'y')
        ) {
          event.preventDefault();
          event.stopPropagation();
          const ctrl = undoRef.current;
          if (ctrl) {
            ctrl.redo();
            // Update textarea to reflect redo
            if (textareaRef.current) {
              const newText = ytext.toString();
              textareaRef.current.value = newText;
              prevValueRef.current = newText;
              const pos = Math.min(newText.length, textareaRef.current.selectionStart);
              textareaRef.current.setSelectionRange(pos, pos);
            }
          }
          return;
        }

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
