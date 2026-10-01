import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, mapCaretThroughDelta } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';
import { useUndoController } from '../board/useUndo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  /** Called after each local change has been written to the Y.Text. */
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undo?: UndoController | null;
  className?: string;
  ariaLabel?: string;
  /** Selector of the element whose inside does not count as "elsewhere" for outside-click. */
  containerSelector?: string;
  style?: CSSProperties;
  /** Close the undo window when editing starts even if the text is empty (sticky notes). */
  boundaryOnEmptyStart?: boolean;
  renderExtra?(length: number): ReactNode;
}

/** A textarea bound to a Y.Text: minimal diffs, length clamp, caret kept through remote edits, undo routing. */
export function TextEditor(props: TextEditorProps) {
  const { ytext, onEnd, maxChars } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [length, setLength] = useState(() => ytext.length);
  const contextUndo = useUndoController();
  const undo = props.undo ?? contextUndo;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(props.onInput);
  onInputRef.current = props.onInput;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A fresh empty text keeps the window open so creating and typing undo as one step.
    if (props.boundaryOnEmptyStart || ytext.length > 0) undoRef.current?.boundary();
    el.value = ytext.toString();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    setLength(el.value.length);
    const onRemote = (event: Y.YTextEvent) => {
      const text = ytext.toString();
      if (composing.current || el.value === text) return;
      // Setting `value` moves the caret to the end; keep it beside the same characters instead.
      const start = mapCaretThroughDelta(el.selectionStart, event.delta);
      const end = mapCaretThroughDelta(el.selectionEnd, event.delta);
      el.value = text;
      el.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length));
      setLength(text.length);
    };
    ytext.observe(onRemote);
    return () => {
      ytext.unobserve(onRemote);
      undoRef.current?.boundary();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  // A pointerdown anywhere outside the object ends editing (capture phase: objects stop propagation).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const container = props.containerSelector ? ref.current?.closest(props.containerSelector) : ref.current;
      if (container && e.target instanceof Node && container.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [props.containerSelector]);

  const flush = () => {
    const el = ref.current;
    if (!el || composing.current) return;
    const clamped = clampToLimit(el.value, maxChars);
    if (clamped !== el.value) {
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    const changed = ytext.toString() !== clamped;
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    setLength(clamped.length);
    if (changed) onInputRef.current();
  };

  return (
    <>
      <textarea
        ref={ref}
        className={props.className}
        aria-label={props.ariaLabel ?? 'Text'}
        spellCheck
        style={{
          fontSize: props.fontPx,
          ...(props.width === 'auto' ? null : { width: props.width }),
          ...props.style,
        }}
        onInput={flush}
        onBlur={flush}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          flush();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          const key = e.key.toLowerCase();
          if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || (key === 'y' && e.ctrlKey))) {
            e.preventDefault();
            if (undo && !composing.current) {
              flush();
              if (key === 'y' || e.shiftKey) undo.redo();
              else undo.undo();
            }
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onEnd('selected');
          }
        }}
      />
      {props.renderExtra?.(length)}
    </>
  );
}
