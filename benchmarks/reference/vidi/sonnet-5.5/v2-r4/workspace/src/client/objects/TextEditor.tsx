import { useEffect, useLayoutEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  /** World width of the editor; 'auto' fills the host element. */
  width: number | 'auto';
  /** Called after every local change has been written to the Y.Text. */
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undo: UndoController;
  ariaLabel?: string;
  lineHeight?: number;
  textAlign?: 'left' | 'center';
  fontFamily?: string;
  /** Keep the textarea inside its host's height (sticky notes). */
  clampHeight?: boolean;
  /** Do not close the undo step on mount, so what is typed joins the step that created the object. */
  continueCapture?: boolean;
}

/** Plain-text editor over a Y.Text: caret at the end, minimal diffs, Escape / outside click end, undo routed to the board. */
export function TextEditor(props: TextEditorProps) {
  const { ytext, maxChars, fontPx, width, onEnd, undo } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const propsRef = useRef(props);
  propsRef.current = props;

  // Edit start and end are step boundaries so typing never merges with neighbouring actions.
  useEffect(() => {
    const u = undoRef.current;
    if (!propsRef.current.continueCapture) u.boundary();
    return () => u.boundary();
  }, []);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const resize = () => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.value = ytext.toString();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    resize();
  }, [ytext]);

  useLayoutEffect(resize, [fontPx, width]);

  // Other people's edits flow into the textarea (keeping the caret in place); without this the next
  // local flush would diff against stale text and delete what they typed.
  useEffect(() => {
    const shift = (sel: number, delta: { retain?: number; insert?: unknown; delete?: number }[]) => {
      let pos = 0;
      for (const op of delta) {
        if (op.retain !== undefined) pos += op.retain;
        else if (typeof op.insert === 'string') {
          if (pos < sel) sel += op.insert.length;
          pos += op.insert.length;
        } else if (op.delete !== undefined && pos < sel) sel -= Math.min(op.delete, sel - pos);
      }
      return sel;
    };
    const observer = (event: Y.YTextEvent, tr: Y.Transaction) => {
      const ta = ref.current;
      if (!ta || tr.origin === LOCAL_ORIGIN) return;
      const start = shift(ta.selectionStart ?? 0, event.delta);
      const end = shift(ta.selectionEnd ?? 0, event.delta);
      ta.value = ytext.toString();
      ta.setSelectionRange(start, end);
      resize();
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const ta = ref.current;
      if (!ta) return;
      const host = ta.closest('[role="group"]');
      if (host && e.target instanceof Node && host.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const flush = () => {
    const ta = ref.current;
    if (!ta || composing.current) return;
    const value = clampToLimit(ta.value, maxChars);
    if (value !== ta.value) {
      const caret = Math.min(ta.selectionStart ?? value.length, value.length);
      ta.value = value;
      ta.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, value, LOCAL_ORIGIN);
    propsRef.current.onInput();
    resize();
  };

  return (
    <textarea
      ref={ref}
      aria-label={props.ariaLabel ?? 'Note text'}
      spellCheck={false}
      onInput={flush}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        flush();
      }}
      onBlur={flush}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
          const k = e.key.toLowerCase();
          const redo = (k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey && !e.shiftKey);
          if (redo || (k === 'z' && !e.shiftKey)) {
            e.preventDefault(); // native textarea undo would diverge from the Y.Text
            e.stopPropagation();
            if (composing.current) return;
            if (redo) undo.redo();
            else undo.undo();
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onEnd('selected');
        }
      }}
      style={{
        width: width === 'auto' ? '100%' : width,
        boxSizing: 'border-box',
        display: 'block',
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        font: 'inherit',
        fontFamily: props.fontFamily,
        fontSize: fontPx,
        lineHeight: props.lineHeight,
        textAlign: props.textAlign ?? 'center',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        padding: 0,
        margin: 0,
        overflow: 'hidden',
        maxHeight: props.clampHeight ? '100%' : undefined,
        color: '#222',
      }}
    />
  );
}
