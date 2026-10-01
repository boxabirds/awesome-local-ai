// src/client/objects/TextEditor.tsx
// Generalised text editor for both sticky notes and text objects.
// Caret at end on mount, Enter newline, Escape/outside click → onEnd,
// minimal Y.Text diff, clamp to maxChars, undo boundaries on start/end.

import { useEffect, useRef, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput?: () => void;
  onEnd: (next: 'selected' | 'unselected') => void;
  undo?: UndoController;
}

export function TextEditor(props: TextEditorProps): ReactElement {
  const { ytext, maxChars, fontPx, onInput, onEnd, undo } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const [, setTextLen] = useState(() => ytext.toString().length);

  // End editing: close the capture window so the typing burst is one step
  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    undo?.boundary();
    onEnd(next);
  }, [onEnd, undo]);

  // On mount (edit start): close the previous capture window; set value, focus, caret at end
  useEffect(() => {
    undo?.boundary();
    const ta = textareaRef.current;
    if (ta) {
      ta.value = ytext.toString();
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }
  }, [ytext, undo]);

  // Listen for outside pointerdown to end editing
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const ta = textareaRef.current;
      if (ta && !ta.contains(e.target as Node)) {
        endEdit('unselected');
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
    };
  }, [endEdit]);

  // After an in-editor undo/redo, resync the textarea from the Y.Text
  const syncFromYText = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.value = ytext.toString();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    setTextLen(len);
  }, [ytext]);

  const handleInput = useCallback(() => {
    if (isComposingRef.current) return;
    const ta = textareaRef.current;
    if (!ta) return;

    let value = ta.value;
    const clamped = clampToLimit(value, maxChars);
    if (clamped !== value) {
      value = clamped;
      ta.value = value;
      ta.setSelectionRange(value.length, value.length);
    }

    applyTextDiff(ytext, value);
    setTextLen(value.length);
    onInput?.();
  }, [ytext, maxChars, onInput]);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    handleInput();
  }, [handleInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      endEdit('selected');
      return;
    }
    // Ctrl/Cmd+Z: undo
    const isCtrlMeta = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (isCtrlMeta && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      undo?.undo();
      syncFromYText();
      return;
    }
    // Ctrl/Cmd+Shift+Z or Ctrl+Y: redo
    if (isCtrlMeta && ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey))) {
      e.preventDefault();
      e.stopPropagation();
      undo?.redo();
      syncFromYText();
      return;
    }
    // Enter inserts newline (default textarea behaviour)
  }, [endEdit, undo, syncFromYText]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <textarea
        ref={textareaRef}
        data-testid="text-editor"
        onInput={handleInput}
        onCompositionStart={() => { isComposingRef.current = true; }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontSize: `${fontPx}px`,
          fontFamily: 'inherit',
          padding: 0,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.3,
        }}
      />
    </div>
  );
}
