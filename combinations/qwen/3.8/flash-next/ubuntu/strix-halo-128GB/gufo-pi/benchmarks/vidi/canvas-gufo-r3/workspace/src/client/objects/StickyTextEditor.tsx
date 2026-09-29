import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from './StickyText';
import { LOCAL_ORIGIN } from '@shared/board-model';
import type { UndoController } from '@client/board/undo';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  padding: number;
  onEnd(next: 'selected' | 'unselected'): void;
  undoController?: UndoController | null;
}

/**
 * Transparent textarea overlaid on the note text while editing.
 * Every input event is written to the Y.Text immediately (minimal diff), so ending
 * editing needs no extra write and characters cannot be lost on unmount.
 */
export function StickyTextEditor({ ytext, fontPx, padding, onEnd, undoController }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const endedRef = useRef(false);
  const unmountedRef = useRef(false);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const undoRef = useRef(undoController);
  undoRef.current = undoController;

  // Mount: seed the value, focus, caret at the end of the text.
  useEffect(() => {
    // Boundary at edit start: prevents merging with the previous action
    undoRef.current?.boundary();
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      // jsdom edge cases; caret placement is best-effort there
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect REMOTE changes (another client editing this note live) into the textarea.
  // Without this, a local commit's minimal diff would recompute against a value that
  // is missing the remote characters and erase them — concurrent typing would lose
  // text. Local commits use LOCAL_ORIGIN and are ignored here. Caret goes to the end,
  // which is the right behaviour for a short shared sticky.
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
          /* caret placement is best-effort */
        }
      }
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // Runs before the DOM node is removed: a blur caused by unmounting must not
  // change selection (the caller has already moved selection elsewhere).
  useLayoutEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const commit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      el.value = clamped;
      const len = clamped.length;
      try {
        el.setSelectionRange(len, len);
      } catch {
        /* noop */
      }
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
  }, [ytext]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    commit();
  }, [commit]);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    // Boundary at edit end: prevents merging typing with the next action
    undoRef.current?.boundary();
    endedRef.current = true;
    onEndRef.current(next);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl/Cmd+Z inside editor: undo typing via controller (prevent browser native undo)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        commit();
        undoRef.current?.undo();
        // Sync textarea back to the ytext after undo
        const el = ref.current;
        if (el) {
          el.value = ytext.toString();
        }
        return;
      }
      // Ctrl/Cmd+Shift+Z or Ctrl+Y inside editor: redo typing
      if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault();
        e.stopPropagation();
        undoRef.current?.redo();
        const el = ref.current;
        if (el) {
          el.value = ytext.toString();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        commit();
        endEdit('selected');
      }
      // Enter is not intercepted: it inserts a newline.
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
      data-testid="sticky-textarea"
      spellCheck={false}
      onChange={handleInput}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        commit();
      }}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        padding: `${padding}px`,
        font: 'inherit',
        fontSize: `${fontPx}px`,
        lineHeight: 1.3,
        color: '#222',
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        boxSizing: 'border-box',
        caretColor: '#222',
      }}
    />
  );
}
