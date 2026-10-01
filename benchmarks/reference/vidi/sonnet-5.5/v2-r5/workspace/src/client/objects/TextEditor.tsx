import { useEffect, useRef, type CSSProperties } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

/** Edit hosts: a pointerdown outside the closest one ends editing. */
const HOST_SELECTOR = '[data-sticky],[data-text-object],[data-shape]';

export function TextEditor(props: {
  ytext: Y.Text; maxChars: number; fontPx: number; width: number | 'auto';
  onInput(): void; onEnd(next: 'selected' | 'unselected'): void; undo?: UndoController;
  /** False for a fresh empty text so creation, typing and an empty-removal stay one undo step. */
  boundaryOnStart?: boolean;
  className?: string; ariaLabel?: string; style?: CSSProperties;
  /** Called with the length after every local or remote change. */
  onLength?(length: number): void;
}) {
  const { ytext, maxChars, fontPx, onEnd } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const undoRef = useRef(props.undo);
  undoRef.current = props.undo;
  const boundaryOnStartRef = useRef(props.boundaryOnStart ?? true);
  const onLengthRef = useRef(props.onLength);
  onLengthRef.current = props.onLength;
  const onInputRef = useRef(props.onInput);
  onInputRef.current = props.onInput;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (boundaryOnStartRef.current) undoRef.current?.boundary(); // edit start
    el.value = ytext.toString();
    onLengthRef.current?.(el.value.length);
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    const onDown = (e: PointerEvent) => {
      const host = el.closest(HOST_SELECTOR);
      if (host && e.target instanceof Node && host.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDown, true);
    // Remote edits are mirrored into the textarea; the caret is carried through the delta.
    const onRemote = (event: Y.YTextEvent, tr: Y.Transaction) => {
      if (tr.origin === LOCAL_ORIGIN) return;
      let start = el.selectionStart;
      let end = el.selectionEnd;
      let pos = 0;
      const shift = (sel: number, op: { insert?: unknown; retain?: number; delete?: number }) => {
        if (typeof op.insert === 'string') return pos <= sel ? sel + op.insert.length : sel;
        if (op.delete) return pos < sel ? sel - Math.min(op.delete, sel - pos) : sel;
        return sel;
      };
      for (const op of event.delta) {
        start = shift(start, op);
        end = shift(end, op);
        if (typeof op.insert === 'string') pos += op.insert.length;
        else if (op.retain) pos += op.retain;
      }
      el.value = ytext.toString();
      el.setSelectionRange(start, end);
      onLengthRef.current?.(el.value.length);
    };
    ytext.observe(onRemote);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      ytext.unobserve(onRemote);
      undoRef.current?.boundary(); // edit end
    };
  }, [ytext]);

  const flush = () => {
    const el = ref.current;
    if (!el || !ytext.doc) return;
    const clamped = clampToLimit(el.value, maxChars);
    if (clamped !== el.value) {
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    const changed = ytext.toString() !== clamped;
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    onLengthRef.current?.(clamped.length);
    if (changed) onInputRef.current();
  };

  return (
    <textarea
      ref={ref}
      className={props.className}
      aria-label={props.ariaLabel}
      style={{ fontSize: fontPx, width: props.width === 'auto' ? undefined : props.width, ...props.style }}
      onInput={() => { if (!composing.current) flush(); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; flush(); }}
      onBlur={() => { if (!composing.current) flush(); }}
      onKeyDown={(e) => {
        const key = e.key.toLowerCase();
        const ctl = props.undo;
        if (ctl && (e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || (key === 'y' && e.ctrlKey))) {
          e.preventDefault(); // native textarea undo would diverge from the Y.Text
          e.stopPropagation();
          if (composing.current) return;
          flush();
          if (key === 'y' || e.shiftKey) ctl.redo(); else ctl.undo();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onEnd('selected');
        }
      }}
    />
  );
}
