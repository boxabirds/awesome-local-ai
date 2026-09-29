import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from '@shared/text-edit';
import { LOCAL_ORIGIN } from '@shared/board-model';
import type { UndoController } from '@client/board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undoController?: UndoController | null;
  /** Additional style for the textarea */
  style?: React.CSSProperties;
}

/**
 * Generalised text editor for text objects (and used by StickyTextEditor via a thin wrapper).
 * Caret at end on mount, Enter inserts newline, Escape/outside click ends,
 * minimal Y.Text diff, clamp to maxChars.
 */
export function TextEditor({ ytext, maxChars, fontPx, width, onInput, onEnd, undoController, style }: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const endedRef = useRef(false);
  const unmountedRef = useRef(false);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const undoRef = useRef(undoController);
  undoRef.current = undoController;

  // Mount: seed value, focus, caret at end
  useEffect(() => {
    undoRef.current?.boundary();
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      // jsdom edge cases
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect remote changes into the textarea
  useEffect(() => {
    const handler = (_event: Y.YTextEvent, origin: unknown) => {
      if (origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el || composingRef.current) return;
      const next = ytext.toString();
      if (el.value !== next) {
        el.value = next;
        const len = next.length;
        try {
          el.setSelectionRange(len, len);
        } catch {
          /* best-effort */
        }
      }
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  useLayoutEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const commit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value, maxChars);
    if (clamped !== el.value) {
      el.value = clamped;
      const len = clamped.length;
      try {
        el.setSelectionRange(len, len);
      } catch {
        /* noop */
      }
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN, maxChars);
  }, [ytext, maxChars]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    commit();
    onInputRef.current();
  }, [commit]);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    undoRef.current?.boundary();
    endedRef.current = true;
    onEndRef.current(next);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl/Cmd+Z inside editor
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        commit();
        undoRef.current?.undo();
        const el = ref.current;
        if (el) el.value = ytext.toString();
        return;
      }
      // Ctrl/Cmd+Shift+Z or Ctrl+Y inside editor
      if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault();
        e.stopPropagation();
        undoRef.current?.redo();
        const el = ref.current;
        if (el) el.value = ytext.toString();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        commit();
        endEdit('selected');
      }
      // Enter is not intercepted: inserts newline
      e.stopPropagation();
    },
    [commit, endEdit, ytext],
  );

  const handleBlur = useCallback(() => {
    commit();
    if (endedRef.current || unmountedRef.current) return;
    endEdit('unselected');
  }, [commit, endEdit]);

  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      spellCheck={false}
      onChange={handleInput}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={() => { composingRef.current = false; commit(); onInputRef.current(); }}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        padding: 0,
        font: 'inherit',
        fontSize: `${fontPx}px`,
        lineHeight: 1.3,
        color: '#222',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        boxSizing: 'border-box',
        caretColor: '#222',
        ...style,
      }}
    />
  );
}
