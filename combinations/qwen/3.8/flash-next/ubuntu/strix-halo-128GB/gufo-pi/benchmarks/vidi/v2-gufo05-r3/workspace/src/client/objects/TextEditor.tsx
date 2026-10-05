/**
 * Generalised text editor (story 9).
 *
 * Extracted from StickyTextEditor so both sticky notes and text objects share
 * the same editing logic: caret at end, Enter for newline, Escape/outside click
 * ends editing, clamp to max chars, undo boundaries on start/end.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import { mapCaret } from './StickyText';
import { useBoardUndo } from '../board/useUndo';
import type { EndEditTarget } from '../board/useSelection';

export interface TextEditorProps {
  /** The shared text; every committed keystroke is written to it. */
  ytext: Y.Text;
  /** Maximum characters to keep. */
  maxChars: number;
  /** Font size in board units. */
  fontPx: number;
  /** Width of the editor (or 'auto'). */
  width: number | 'auto';
  /** Called after each local input (for box sync). */
  onInput?(): void;
  /** Escape ends editing keeping selection; outside click drops it. */
  onEnd(next: EndEditTarget): void;
  /** Extra class name for styling. */
  className?: string;
  /** Aria label for the textarea. */
  ariaLabel?: string;
}

/**
 * Generalised text editing component.
 *
 * The textarea is uncontrolled: each input event is clamped and written into
 * the shared Y.Text with the minimal diff. IME composition is handled: raw buffer
 * left alone until compositionend.
 */
export function TextEditor(props: TextEditorProps) {
  const { ytext, maxChars, fontPx, width, onInput, onEnd, className, ariaLabel } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const mountedRef = useRef(true);
  const undo = useBoardUndo();
  const [, setLength] = useState(() => ytext.toString().length);

  // Edit start and end close the undo capture window.
  useEffect(() => {
    undo?.boundary();
    return () => {
      undo?.boundary();
    };
  }, [undo, ytext]);

  // Edit start: seed value, focus, caret at end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const value = ytext.toString();
    el.value = value;
    setLength(value.length);
    el.focus();
    el.setSelectionRange(value.length, value.length);
  }, [ytext]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Remote typing observer.
  useEffect(() => {
    const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (composingRef.current) return;
      const el = ref.current;
      if (!el) return;
      if (transaction.origin === LOCAL_ORIGIN) {
        setLength(el.value.length);
        return;
      }
      const next = ytext.toString();
      const prev = el.value;
      if (next === prev) return;
      const start = mapCaret(prev, next, el.selectionStart ?? 0);
      const end = mapCaret(prev, next, el.selectionEnd ?? start);
      el.value = next;
      el.setSelectionRange(start, end);
      setLength(next.length);
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const raw = el.value;
    const next = clampToLimit(raw, maxChars);
    if (next !== raw) {
      const caret = Math.min(el.selectionStart, next.length);
      el.value = next;
      el.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    setLength(next.length);
    onInput?.();
  };

  const onUndoKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && key === 'z') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) undo?.redo();
      else undo?.undo();
      return;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === 'y') {
      e.preventDefault();
      e.stopPropagation();
      undo?.redo();
    }
  };

  const editorStyle: React.CSSProperties = {
    fontSize: `${fontPx}px`,
    fontFamily: 'inherit',
    lineHeight: 1.3,
    border: 'none',
    outline: 'none',
    resize: 'none',
    background: 'transparent',
    padding: 0,
    margin: 0,
    width: width === 'auto' ? undefined : `${width}px`,
    overflow: 'hidden',
    whiteSpace: 'pre-wrap' as const,
    wordWrap: 'break-word' as const,
  };

  return (
    <div
      className={className}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        className="text-editor-textarea"
        data-text-editor=""
        aria-label={ariaLabel ?? 'Text content'}
        style={editorStyle}
        defaultValue=""
        spellCheck={false}
        onChange={() => {
          if (!composingRef.current) commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            commit();
            onEnd('selected');
            return;
          }
          // Enter inserts a newline (default textarea behaviour).
          onUndoKey(e);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commit();
        }}
        onBlur={() => {
          if (mountedRef.current && !composingRef.current) commit();
          undo?.boundary();
        }}
      />
    </div>
  );
}
