/**
 * Generalised text editor (story 9). Shared by sticky notes and text objects.
 * Renders a textarea that syncs with a Y.Text using minimal diffs.
 */
import { useEffect, useRef, useCallback, type JSX } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undo?: UndoController | null;
}

/**
 * Generalised text editing component. Renders a textarea that syncs
 * with a Y.Text using minimal diffs.
 */
export function TextEditor(props: TextEditorProps): JSX.Element {
  const { ytext, maxChars, fontPx, width, onInput, onEnd, undo } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  // On mount: start a fresh undo step for the editing session (story 8),
  // set value from Y.Text, focus, caret at end.
  useEffect(() => {
    undo?.boundary();
    const ta = textareaRef.current;
    if (!ta) return;
    ta.value = ytext.toString();
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }, [ytext, undo]);

  // Remote Y.Text changes → textarea, preserving the caret.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const handler = (_ev: Y.YEvent<Y.Text>, tr: Y.Transaction) => {
      if (tr.origin === 'editor') return;
      const oldValue = ta.value;
      const newValue = ytext.toString();
      if (oldValue === newValue) return;
      const selStart = ta.selectionStart ?? oldValue.length;
      const selEnd = ta.selectionEnd ?? oldValue.length;
      let prefix = 0;
      while (prefix < oldValue.length && prefix < newValue.length && oldValue[prefix] === newValue[prefix]) {
        prefix++;
      }
      const delta = newValue.length - oldValue.length;
      const adj = (pos: number) =>
        pos <= prefix ? pos : Math.max(prefix, Math.min(newValue.length, pos + delta));
      ta.value = newValue;
      ta.setSelectionRange(adj(selStart), adj(selEnd));
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // End editing, closing the typing step first (story 8).
  const endEditing = useCallback(
    (next: 'selected' | 'unselected') => {
      undo?.boundary();
      onEnd(next);
    },
    [undo, onEnd],
  );

  // Handle pointerdown outside → end editing as unselected
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const ta = textareaRef.current;
      if (ta && !ta.contains(e.target as Node)) {
        endEditing('unselected');
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [endEditing]);

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (composingRef.current) return;

    let value = ta.value;
    const clamped = clampToLimit(value, maxChars);
    if (clamped !== value) {
      ta.value = clamped;
      ta.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, ta.value);
    onInputRef.current();
  }, [ytext, maxChars]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        e.stopPropagation();
        if (undo) {
          if (e.shiftKey || e.key === 'y' || e.key === 'Y') {
            undo.redo();
          } else {
            undo.undo();
          }
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endEditing('selected');
      }
      // Enter inserts a newline (default textarea behaviour)
    },
    [undo, endEditing],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    const ta = textareaRef.current;
    if (!ta) return;
    let value = ta.value;
    const clamped = clampToLimit(value, maxChars);
    if (clamped !== value) {
      ta.value = clamped;
      ta.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, ta.value);
    onInputRef.current();
  }, [ytext, maxChars]);

  const handleBlur = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const current = ytext.toString();
    if (ta.value !== current) {
      const clamped = clampToLimit(ta.value, maxChars);
      applyTextDiff(ytext, clamped);
    }
  }, [ytext, maxChars]);

  const widthStyle = width === 'auto' ? '100%' : `${width}px`;

  return (
    <div style={editorContainerStyle} data-testid="text-editor">
      <textarea
        ref={textareaRef}
        data-testid="text-textarea"
        style={{
          ...editorTextareaStyle,
          fontSize: `${fontPx}px`,
          width: widthStyle,
        }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={handleBlur}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </div>
  );
}

const editorContainerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
};

const editorTextareaStyle: React.CSSProperties = {
  height: '100%',
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  lineHeight: 1.3,
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
