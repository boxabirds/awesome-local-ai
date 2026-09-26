import {
  useEffect,
  useRef,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import * as Y from 'yjs';
import {
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit, applyTextDiff, counterVisible, mergeRemoteText } from './StickyText';
import { useUndoController } from '../board/UndoContext';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * Textarea-based text editor for sticky notes.
 * Mounts with caret at end, writes minimal diffs to Y.Text on each input event,
 * and folds remote edits of the same note into the textarea, so two people
 * typing in one note keep every character.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const undoCtrlRef = useUndoController();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  /** The Y.Text content the textarea value was last derived from. */
  const syncedRef = useRef('');

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Set value from Y.Text and place caret at end
    const text = ytext.toString();
    syncedRef.current = text;
    ta.value = text;
    ta.focus();
    ta.setSelectionRange(text.length, text.length);
    // Close the capture window at edit start so the edit doesn't merge with prior actions
    undoCtrlRef?.boundary();
  }, [ytext]);

  useEffect(() => {
    const observe = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const ta = textareaRef.current;
      if (!ta) return;
      const after = ytext.toString();
      const before = syncedRef.current;
      if (after === before) return;
      const merged = mergeRemoteText(ta.value, before, after, {
        start: ta.selectionStart ?? ta.value.length,
        end: ta.selectionEnd ?? ta.value.length,
      });
      syncedRef.current = after;
      ta.value = merged.value;
      ta.setSelectionRange(merged.selection.start, merged.selection.end);
    };
    ytext.observe(observe);
    return () => {
      ytext.unobserve(observe);
    };
  }, [ytext]);

  const handleInput = () => {
    if (composingRef.current) return;
    flush();
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    flush();
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const flush = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const raw = ta.value;
    const clamped = clampToLimit(raw);
    if (clamped !== raw) {
      // Restore caret to end of kept text
      const caretPos = clamped.length;
      ta.value = clamped;
      ta.setSelectionRange(caretPos, caretPos);
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    syncedRef.current = ytext.toString();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      flush();
      // Close the capture window at edit end
      undoCtrlRef?.boundary();
      onEnd('selected');
      return;
    }
    // Undo/redo inside the editor (story 8)
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      flush();
      undoCtrlRef?.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      flush();
      undoCtrlRef?.redo();
      return;
    }
    if (event.ctrlKey && !event.metaKey && (event.key === 'y' || event.key === 'Y')) {
      event.preventDefault();
      flush();
      undoCtrlRef?.redo();
      return;
    }
    // Enter inserts a newline (default textarea behaviour), we don't intercept
  };

  const text = ytext.toString();
  const showCounter = counterVisible(text.length);

  return (
    <div className="sticky-text-editor" data-testid="sticky-text-editor">
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        style={{ fontSize: `${fontPx}px` }}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        data-testid="sticky-textarea"
      />
      {showCounter && (
        <span className="sticky-counter" data-testid="sticky-counter">
          {text.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
