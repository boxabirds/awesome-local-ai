/**
 * Text editing overlay for a sticky note.
 * Mounts a textarea; writes every change into the Y.Text with a minimal diff.
 * Story 8: calls undo.boundary() on mount and on end; intercepts Ctrl/Cmd+Z
 * inside the textarea to use the UndoController (prevents native textarea undo
 * from diverging from the Y.Text).
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';
import type { UndoController } from '../board/undo';

export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
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
  }, []);

  // Outside pointerdown handler
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) {
        // Story 8: boundary on edit end
        undoRef.current?.boundary();
        onEndRef.current('unselected');
      }
    };
    // Use a timeout so the current event loop finishes before we listen
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
    const next = clampToLimit(ta.value);
    if (next !== ta.value) {
      ta.value = next;
      const len = next.length;
      ta.setSelectionRange(len, len);
    }
    setText(next);
    applyTextDiff(props.ytext, next, LOCAL_ORIGIN);
  }, [props.ytext]);

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
        // Story 8: boundary on edit end
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
        // Sync textarea state from Y.Text after undo
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

  const showCounter = counterVisible(text.length);

  return (
    <div ref={rootRef} className="sticky-editor">
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        value={text}
        onChange={handleInput}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!composingRef.current) flushValue();
        }}
        style={{ fontSize: `${props.fontPx}px` }}
        aria-label="Sticky note text"
      />
      {showCounter && (
        <span className="sticky-counter" data-testid="sticky-counter">
          {text.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
