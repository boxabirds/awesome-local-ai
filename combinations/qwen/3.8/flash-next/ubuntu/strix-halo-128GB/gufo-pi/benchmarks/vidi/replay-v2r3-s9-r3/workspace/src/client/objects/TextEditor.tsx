import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undoController?: UndoController;
}

/**
 * Generalised text editor used by both StickyTextEditor and TextObject.
 * Caret at end on mount, Enter inserts newline, Escape/outside click ends,
 * minimal Y.Text diff, clamps to maxChars, undo boundaries on start/end.
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput: onInputCb,
  onEnd,
  undoController,
}: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const flush = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value, maxChars);
    if (clamped !== el.value) {
      const caret = Math.min(el.selectionStart ?? clamped.length, clamped.length);
      el.value = clamped;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* jsdom */
      }
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    onInputCb();
  }, [ytext, maxChars, onInputCb]);

  // Edit start boundary
  useEffect(() => {
    undoController?.boundary();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus and caret at end
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {
      /* jsdom */
    }
  }, [ytext]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    flush();
  }, [flush]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    flush();
  }, [flush]);

  const finish = useCallback(
    (next: 'selected' | 'unselected') => {
      if (endedRef.current) return;
      endedRef.current = true;
      flush();
      onEndRef.current(next);
    },
    [flush],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish('selected');
        return;
      }
      // Intercept Ctrl/Cmd+Z etc. so native textarea undo never diverges
      if (undoController) {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          undoController.undo();
          const el = ref.current;
          if (el) el.value = ytext.toString();
          return;
        }
        if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          undoController.redo();
          const el = ref.current;
          if (el) el.value = ytext.toString();
          return;
        }
        if (e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
          e.preventDefault();
          undoController.redo();
          const el = ref.current;
          if (el) el.value = ytext.toString();
          return;
        }
      }
      // Enter is left to the textarea (inserts newline)
    },
    [finish, undoController, ytext],
  );

  // Outside click ends editing
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (!target) return;
      // Check if click is within the parent container
      const container = el.parentElement;
      if (container && container.contains(target)) return;
      if (el.contains(target)) return;
      finish('unselected');
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [finish]);

  // End-edit boundary on unmount
  useEffect(() => {
    return () => {
      undoController?.boundary();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const widthStyle = width === 'auto' ? undefined : width;

  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      defaultValue=""
      spellCheck={false}
      onInput={handleInput}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={handleKeyDown}
      onBlur={flush}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: widthStyle ?? '100%',
        height: '100%',
        padding: 0,
        margin: 0,
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        background: 'transparent',
        color: '#1f1f1f',
        caretColor: '#1f1f1f',
        fontFamily: 'inherit',
        fontWeight: 400,
        lineHeight: 1.3,
        fontSize: fontPx,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    />
  );
}
