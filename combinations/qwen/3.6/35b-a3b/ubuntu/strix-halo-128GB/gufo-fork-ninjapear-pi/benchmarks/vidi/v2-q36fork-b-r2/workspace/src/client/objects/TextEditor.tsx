import * as React from 'react';
import type { Doc, Text } from 'yjs';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';

interface TextEditorProps {
  ytext: Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undo?: () => void;
  redo?: () => void;
}

/**
 * Generalised text editor — used for both text objects and sticky notes.
 * Handles caret at end on mount, Enter newline, Escape/outside click → onEnd,
 * minimal applyTextDiff, clamp to max chars, undo boundaries on start/end.
 */
export function TextEditor(props: TextEditorProps): React.JSX.Element {
  const { ytext, maxChars, fontPx, width, onInput, onEnd, undo, redo } = props;

  const ref = React.useRef<HTMLTextAreaElement>(null);
  const composingRef = React.useRef(false);
  const initializedRef = React.useRef(false);

  // Track current Y.Text content for diffing
  const prevContentRef = React.useRef(ytext.toString());

  // On mount, focus with caret at end
  React.useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const el = ref.current;
    if (!el) return;
    
    // Focus after a frame to ensure textarea is painted
    requestAnimationFrame(() => {
      el.focus();
      const len = ytext.length;
      el.setSelectionRange(len, len);
    });
  }, []);

  // Listen for remote changes to sync display
  React.useEffect(() => {
    const handler = () => {
      // Remote content changed — the textarea value will be updated via re-render
      prevContentRef.current = ytext.toString();
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // Handle input events (with IME awareness)
  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (composingRef.current) return;
      
      const nextRaw = e.target.value;
      const next = clampToLimit(nextRaw, maxChars);
      
      // Apply minimal diff
      applyTextDiff(ytext, next, 'local');
      
      prevContentRef.current = next;
      onInput();
    },
    [ytext, maxChars, onInput],
  );

  const handleCompositionStart = React.useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = React.useCallback(() => {
    composingRef.current = false;
    // After IME composition ends, sync final content
    if (ref.current) {
      const next = clampToLimit(ref.current.value, maxChars);
      applyTextDiff(ytext, next, 'local');
      prevContentRef.current = next;
      onInput();
    }
  }, [ytext, maxChars, onInput]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEnd('selected');
        return;
      }
      // Undo / Redo shortcuts inside the textarea
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (ctrlOrMeta && undo && redo) {
        if ((e.key === 'z' && !e.shiftKey) || (e.key === 'Z')) {
          e.preventDefault();
          e.stopPropagation();
          undo();
          return;
        }
        if ((e.key === 'z' && e.shiftKey) || (e.key === 'y')) {
          e.preventDefault();
          e.stopPropagation();
          redo();
          return;
        }
      }
      // Enter inserts newline (default textarea behavior)
      // Backspace/Delete edit characters (default textarea behavior)
    },
    [onEnd, undo, redo],
  );

  // Pointer down on outside element calls onEnd — handled by parent
  const handleBlur = React.useCallback(() => {
    onEnd('unselected');
  }, [onEnd]);

  return (
    <textarea
      ref={ref}
      value={ytext.toString()}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onBlur={handleBlur}
      rows={1}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        fontSize: `${fontPx}px`,
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#333',
        textAlign: 'left',
        padding: '4px 8px',
        boxSizing: 'border-box',
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',
        lineHeight: '1.3',
        zIndex: 10,
        cursor: 'text',
        userSelect: 'text',
        overflow: 'hidden',
      }}
      aria-label="Edit text"
    />
  );
}
