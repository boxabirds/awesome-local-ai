/**
 * Generalised text editor component: used by both StickyTextEditor (via wrapper)
 * and TextObject. Supports configurable maxChars, fontPx, width, and onEnd.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, JSX } from 'react';
import type * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';

export interface TextEditorProps {
  /** The shared text to edit. */
  ytext: Y.Text;
  /** Maximum characters allowed. */
  maxChars: number;
  /** Font size in world units (px at zoom 1). */
  fontPx: number;
  /** Width of the editor box in world units, or 'auto'. */
  width: number | 'auto';
  /** Called when the text content changes (after applying to Y.Text). */
  onInput(): void;
  /** Called when editing ends (Escape or blur). */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Called on mount (edit start) and on end to close undo capture windows. */
  undoBoundary?(): void;
  /** Undo controller for Ctrl+Z inside the textarea. */
  undoCtrl?: { undo(): boolean; redo(): boolean };
}

/**
 * The textarea for editing text content (generalised from StickyTextEditor).
 *
 * - On mount it takes the current text, focuses and puts the caret at the end.
 * - Every `input` event writes to the shared text immediately (clamped, minimal diff).
 * - IME composition is left alone until `compositionend`.
 * - Enter inserts a newline; Escape leaves editing.
 * - Ctrl/Cmd+Z routes to the undo controller.
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undoBoundary,
  undoCtrl,
}: TextEditorProps): JSX.Element {
  const elementRef = useRef<HTMLTextAreaElement | null>(null);
  /** True between `compositionstart` and `compositionend` (IME input). */
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  /** Push the textarea's value into the document. */
  const flush = useCallback((): void => {
    const element = elementRef.current;
    if (!element) return;
    const raw = element.value;
    const kept = clampToLimit(raw, maxChars);
    if (kept !== raw) {
      element.value = kept;
      try {
        element.setSelectionRange(kept.length, kept.length);
      } catch {
        // A browser that will not move the caret does not change what is kept.
      }
    }
    applyTextDiff(ytext, kept, LOCAL_ORIGIN);
    onInputRef.current();
  }, [ytext, maxChars]);

  // Start editing: value from the document, focus, caret at the end.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.value = ytext.toString();
    element.focus();
    const end = element.value.length;
    try {
      element.setSelectionRange(end, end);
    } catch {
      // jsdom and detached elements can refuse caret work.
    }
    // Close capture window at edit start.
    undoBoundary?.();
  }, [ytext]);

  const handleInput = (): void => {
    if (composingRef.current) return;
    flush();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // Ctrl/Cmd+Z inside the textarea: undo via the controller.
    if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      undoCtrl?.undo();
      return;
    }
    // Ctrl/Cmd+Shift+Z or Ctrl+Y: redo inside the textarea.
    if (
      ((event.ctrlKey || event.metaKey) && event.key === 'z' && event.shiftKey) ||
      (event.ctrlKey && event.key === 'y')
    ) {
      event.preventDefault();
      event.stopPropagation();
      undoCtrl?.redo();
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    flush();
    // Close capture window at edit end.
    undoBoundary?.();
    onEndRef.current('selected');
  };

  return (
    <textarea
      ref={elementRef}
      className="text-editor"
      data-testid="text-editor"
      aria-label="Text content"
      defaultValue={ytext.toString()}
      style={{
        fontSize: `${fontPx}px`,
        width: width === 'auto' ? undefined : `${width}px`,
        fontFamily: 'Inter, system-ui, sans-serif',
        lineHeight: '1.3',
        padding: 0,
        border: 0,
        background: 'transparent',
        color: 'inherit',
        resize: 'none',
        overflow: 'hidden',
        outline: 'none',
        caretColor: 'inherit',
        userSelect: 'text',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        display: 'block',
      }}
      onChange={handleInput}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        flush();
      }}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onBlur={() => {
        if (!composingRef.current) flush();
      }}
    />
  );
}
