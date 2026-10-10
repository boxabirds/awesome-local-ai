// Text editing for any editable object (generalised from story 2's sticky
// editor): a textarea whose every input is written to the shared Y.Text with
// the minimal diff, clamped to maxChars. Ending editing performs no extra
// write because each input event was already applied. Sticky-specific parts
// (counter, font auto-fit) are optional props; StickyTextEditor is a thin
// wrapper that keeps story 2's behaviour exactly.

import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { fitFontSize } from './StickyText';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  // Editor width in world units; 'auto' lets the field follow the box.
  width: number | 'auto';
  // Called after every input flush (drives text box re-measure).
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undo?: UndoController;
  // Story 2 extras: a visible counter once remaining <= counterThreshold,
  // and font auto-fit inside a `fitBox` px box. Omit both for plain text.
  counterThreshold?: number;
  fitBox?: number;
  wrapClassName?: string;
  textareaClassName?: string;
  textareaTestId?: string;
  counterTestId?: string;
  ariaLabel?: string;
}

export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
  counterThreshold,
  fitBox,
  wrapClassName = 'text-editor',
  textareaClassName = 'text-editor-textarea',
  textareaTestId = 'text-editor',
  counterTestId,
  ariaLabel = 'Text content',
}: TextEditorProps): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const [length, setLength] = useState(() => ytext.toString().length);

  // Editing is its own undo step: boundaries open and close it (undo.boundaries).
  useEffect(() => {
    undoRef.current?.boundary();
    return () => undoRef.current?.boundary();
  }, [ytext]);

  // Start editing: value from Y.Text, focus, caret at end.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    setLength(len);
  }, [ytext]);

  // Mirror remote edits into the textarea while typing (story 3: concurrent
  // editors). Caret is kept at the same distance from the text end so typing
  // at the end stays at the end while remote characters arrive.
  useEffect(() => {
    const observer = (event: Y.YTextEvent, txn: Y.Transaction): void => {
      if (txn.origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el) return;
      const next = ytext.toString();
      if (!composingRef.current) {
        const oldLen = el.value.length;
        const selStart = el.selectionStart ?? oldLen;
        const selEnd = el.selectionEnd ?? oldLen;
        el.value = next;
        const clamp = (fromEnd: number): number =>
          Math.max(0, Math.min(next.length, next.length - fromEnd));
        const a = clamp(oldLen - selStart);
        const f = clamp(oldLen - selEnd);
        el.setSelectionRange(Math.min(a, f), Math.max(a, f));
        if (fitBox !== undefined) fitFontSize(el, fitBox);
      }
      setLength(next.length);
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext, fitBox]);

  // Click outside the object ends editing unselected.
  useEffect(() => {
    const onWindowPointerDown = (e: PointerEvent) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      if (e.target instanceof Node && wrap.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    window.addEventListener('pointerdown', onWindowPointerDown, true);
    return () => window.removeEventListener('pointerdown', onWindowPointerDown, true);
  }, []);

  const flush = (): void => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value, maxChars);
    if (clamped !== el.value) {
      // Characters beyond the limit are dropped; caret goes to end of kept text.
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    setLength(el.value.length);
    if (fitBox !== undefined) fitFontSize(el, fitBox);
    onInputRef.current();
  };

  const showCounter = counterThreshold !== undefined && maxChars - length <= counterThreshold;

  return (
    <div className={wrapClassName} ref={wrapRef} onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        className={textareaClassName}
        data-testid={textareaTestId}
        aria-label={ariaLabel}
        style={{ fontSize: fontPx, width: width === 'auto' ? undefined : width }}
        defaultValue=""
        spellCheck={false}
        onInput={() => {
          if (!composingRef.current) flush();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          flush();
        }}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
            // Native textarea undo would diverge from Y.Text: route to the
            // controller (undo.boundaries). The observer above mirrors the
            // result back into the textarea (origin is the manager, not us).
            e.preventDefault();
            e.stopPropagation();
            flush();
            const controller = undoRef.current;
            if (!controller) return;
            if (e.key === 'y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
              controller.redo();
            } else {
              controller.undo();
            }
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            ref.current?.blur();
            onEndRef.current('selected');
          }
        }}
        onBlur={flush}
      />
      {showCounter && counterTestId !== undefined && (
        <div className="sticky-counter" data-testid={counterTestId}>
          {length}/{maxChars}
        </div>
      )}
    </div>
  );
}
