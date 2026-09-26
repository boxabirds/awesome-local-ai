import {
  useEffect,
  useRef,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit, applyTextDiff, mergeRemoteText } from './StickyText';
import { useUndoController } from '../board/UndoContext';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Character limit — TEXT_MAX_CHARS for text objects, sticky's for notes. */
  maxChars: number;
  fontPx: number;
  /**
   * Width of the editable area in world pixels: the stored box width for a
   * text object (grows with typing while auto), 'auto' fills the container
   * like the sticky editor always has.
   */
  width?: number | 'auto';
  /**
   * Called after every flushed change, inside the same undo capture window.
   * Text objects remeasure their box here.
   */
  onInput?(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Counter visibility: shown when counterThreshold is given and reached. */
  counterThreshold?: number;
  counterMax?: number;
  /** Styling and test ids so notes and text objects share one editor. */
  containerClassName?: string;
  containerTestId?: string;
  textareaClassName?: string;
  textareaTestId?: string;
  counterClassName?: string;
  counterTestId?: string;
}

/**
 * The shared textarea editor for board text (story 9, generalised from
 * StickyTextEditor): mounts with the caret at the end, writes minimal diffs
 * to the Y.Text on each input event, and folds remote edits of the same text
 * into the textarea, so two people typing together keep every character.
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width = 'auto',
  onInput,
  onEnd,
  counterThreshold,
  counterMax,
  containerClassName = 'sticky-text-editor',
  containerTestId = 'sticky-text-editor',
  textareaClassName = 'sticky-textarea',
  textareaTestId = 'sticky-textarea',
  counterClassName = 'sticky-counter',
  counterTestId = 'sticky-counter',
}: TextEditorProps): JSX.Element {
  const undoCtrlRef = useUndoController();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  /** The Y.Text content the textarea value was last derived from. */
  const syncedRef = useRef('');
  /** Latest onInput without re-attaching effects. */
  const onInputRef = useRef(onInput);
  useEffect(() => {
    onInputRef.current = onInput;
  });

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

  const flush = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const raw = ta.value;
    const clamped = clampToLimit(raw, maxChars);
    if (clamped !== raw) {
      // Restore caret to end of kept text
      const caretPos = clamped.length;
      ta.value = clamped;
      ta.setSelectionRange(caretPos, caretPos);
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    syncedRef.current = ytext.toString();
    onInputRef.current?.();
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  const handleInput = () => {
    if (composingRef.current) return;
    flushRef.current();
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    flushRef.current();
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      flushRef.current();
      // onEnd first so the object can delete itself empty inside this same
      // capture window, then close the window at edit end.
      onEnd('selected');
      undoCtrlRef?.boundary();
      return;
    }
    // Undo/redo inside the editor (story 8)
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      flushRef.current();
      undoCtrlRef?.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      flushRef.current();
      undoCtrlRef?.redo();
      return;
    }
    if (event.ctrlKey && !event.metaKey && (event.key === 'y' || event.key === 'Y')) {
      event.preventDefault();
      flushRef.current();
      undoCtrlRef?.redo();
      return;
    }
    // Enter inserts a newline (default textarea behaviour), we don't intercept
  };

  const text = ytext.toString();
  const showCounter = counterThreshold !== undefined && text.length >= counterThreshold;

  return (
    <div
      className={containerClassName}
      data-testid={containerTestId}
      style={{ width: '100%', height: '100%' }}
    >
      <textarea
        ref={textareaRef}
        className={textareaClassName}
        style={{
          fontSize: `${fontPx}px`,
          ...(width === 'auto' ? {} : { width: `${width}px`, maxWidth: 'none' }),
        }}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        data-testid={textareaTestId}
      />
      {showCounter && counterMax !== undefined && (
        <span className={counterClassName} data-testid={counterTestId}>
          {text.length}/{counterMax}
        </span>
      )}
    </div>
  );
}
