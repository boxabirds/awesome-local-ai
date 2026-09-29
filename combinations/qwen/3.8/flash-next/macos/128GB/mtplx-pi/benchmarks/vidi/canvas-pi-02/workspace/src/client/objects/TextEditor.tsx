/**
 * TextEditor (story 9): generalised from the StickyTextEditor.
 *
 * A textarea for editing text objects. Features:
 * - caret at end on mount
 * - Enter inserts newline (does not submit)
 * - Escape ends editing
 * - Clamps to maxChars
 * - Uses applyTextDiff for minimal Y.Text changes
 * - Undo boundaries on mount/unmount
 * - Ctrl/Cmd+Z routed to the undo controller
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
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
  undo?: UndoController;
}

export function TextEditor(props: TextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef<boolean>(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const value = props.ytext.toString();
    el.value = value;
    el.focus();
    try {
      el.setSelectionRange(value.length, value.length);
    } catch {
      // A textarea without layout can refuse the selection.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Observe remote changes to Y.Text and update the textarea.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ytext = props.ytext;
    const observer = (_event: Y.YTextEvent, tx: { origin?: unknown }) => {
      // Only react to remote (non-local) changes.
      if (tx.origin === LOCAL_ORIGIN) return;
      const newValue = ytext.toString();
      // Update textarea preserving cursor position.
      const cursorPos = el.selectionStart;
      const oldLen = el.value.length;
      el.value = newValue;
      // Approximate cursor adjustment
      const delta = newValue.length - oldLen;
      const newPos = Math.max(0, Math.min(cursorPos + delta, newValue.length));
      try { el.setSelectionRange(newPos, newPos); } catch { /* noop */ }
    };
    ytext.observe(observer);
    return () => { ytext.unobserve(observer); };
  }, [props.ytext]);

  useLayoutEffect(() => {
    const undo = props.undo;
    undo?.boundary();
    return () => {
      undo?.boundary();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = useCallback(
    (raw: string) => {
      const el = ref.current;
      if (!el) return;
      const clamped = clampToLimit(raw, props.maxChars);
      if (el.value !== clamped) {
        // Re-truncate the displayed value.
        const sel = el.selectionStart;
        const selEnd = el.selectionEnd;
        el.value = clamped;
        try {
          el.setSelectionRange(
            Math.min(sel, clamped.length),
            Math.min(selEnd, clamped.length),
          );
        } catch {
          // May fail in edge cases.
        }
      }
      if (clamped !== props.ytext.toString()) {
        props.ytext.doc?.transact(() => {
          applyTextDiff(props.ytext, clamped, LOCAL_ORIGIN);
        }, LOCAL_ORIGIN);
      }
      props.onInput();
    },
    [props],
  );

  const handleInput = useCallback(
    (_e: React.FormEvent<HTMLTextAreaElement>) => {
      if (composingRef.current) return;
      const el = ref.current;
      if (!el) return;
      commit(el.value);
    },
    [commit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl/Cmd+Z: undo
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const undo = props.undo;
        if (undo) {
          if (e.shiftKey) undo.redo();
          else undo.undo();
          // Sync textarea with the doc after undo
          const el = ref.current;
          if (el) {
            const newVal = props.ytext.toString();
            if (el.value !== newVal) {
              el.value = newVal;
            }
          }
        }
        return;
      }
      // Enter: insert newline (no submit)
      if (e.key === 'Enter') {
        e.preventDefault();
        const el = ref.current;
        if (!el) return;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const val = el.value;
        const newVal = val.slice(0, start) + '\n' + val.slice(end);
        commit(newVal);
        try {
          el.setSelectionRange(start + 1, start + 1);
        } catch {
          // ignore
        }
        return;
      }
      // Escape: end editing
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onEnd('selected');
        return;
      }
    },
    [commit, props],
  );

  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      style={{
        position: 'absolute',
        inset: 0,
        margin: 0,
        padding: 0,
        border: 'none',
        background: 'transparent',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        font: `${props.fontPx}px Inter, system-ui, sans-serif`,
        lineHeight: 1.3,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        width: props.width === 'auto' ? '100%' : props.width,
        minHeight: '1em',
      }}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={() => {
        composingRef.current = false;
        const el = ref.current;
        if (el) commit(el.value);
      }}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        const el = ref.current;
        if (!el) return;
        const value = el.value;
        if (value !== props.ytext.toString()) {
          commit(value);
        }
        props.onEnd('selected');
      }}
    />
  );
}