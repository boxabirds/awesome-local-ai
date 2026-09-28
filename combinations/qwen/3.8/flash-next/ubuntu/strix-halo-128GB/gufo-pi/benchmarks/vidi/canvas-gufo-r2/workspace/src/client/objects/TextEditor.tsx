/**
 * Generalised text editing overlay (story 9).
 *
 * Generalises story 2's StickyTextEditor: takes maxChars, fontPx, width,
 * onInput (to trigger box sync), and onEnd. Caret at end on mount, Enter adds
 * newline, Escape/outside click ends editing, applies minimal Y.Text diff,
 * clamps to maxChars, undo boundaries on start/end, Ctrl/Cmd+Z routed to UndoController.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export function TextEditor(props: {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undo?: UndoController;
}): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [text, setText] = useState(() => props.ytext.toString());
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Story 8: boundary on mount (edit start)
  const undoRef = useRef(props.undo);
  undoRef.current = props.undo;

  useEffect(() => {
    undoRef.current?.boundary();
  }, []);

  // On mount: set caret to end, focus
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
    // Re-focus on next frame in case the browser's pointer/click handling steals focus
    const raf = requestAnimationFrame(() => {
      if (document.activeElement !== ta) ta.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Outside pointerdown handler
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) {
        undoRef.current?.boundary();
        onEndRef.current('unselected');
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  const flushValue = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const next = clampToLimit(ta.value, props.maxChars);
    if (next !== ta.value) {
      ta.value = next;
      const len = next.length;
      ta.setSelectionRange(len, len);
    }
    setText(next);
    applyTextDiff(props.ytext, next, LOCAL_ORIGIN);
    props.onInput();
  }, [props.ytext, props.maxChars, props.onInput]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    flushValue();
  }, [flushValue]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    flushValue();
  }, [flushValue]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        undoRef.current?.boundary();
        props.onEnd('selected');
        return;
      }
      // Story 8: intercept undo/redo inside the textarea
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        e.stopPropagation();
        undoRef.current?.undo();
        setText(props.ytext.toString());
        return;
      }
      if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        e.stopPropagation();
        undoRef.current?.redo();
        setText(props.ytext.toString());
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        e.stopPropagation();
        undoRef.current?.redo();
        setText(props.ytext.toString());
        return;
      }
      // Prevent Delete/Backspace from reaching window handlers
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.stopPropagation();
      }
    },
    [props],
  );

  const widthStyle = props.width === 'auto' ? 'auto' : `${props.width}px`;

  return (
    <div ref={rootRef} className="text-editor" style={{ width: widthStyle }}>
      <textarea
        ref={textareaRef}
        className="text-editor-textarea"
        value={text}
        onChange={handleInput}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!composingRef.current) flushValue();
        }}
        style={{
          fontSize: `${props.fontPx}px`,
          fontFamily: 'Inter, system-ui, sans-serif',
          width: widthStyle,
          resize: 'none',
          overflow: 'hidden',
          border: 'none',
          outline: 'none',
          padding: 0,
          background: 'transparent',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          display: 'block',
        }}
        aria-label="Text content"
      />
    </div>
  );
}
