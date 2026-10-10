import { useEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';
import type { EndEditNext } from './StickyText';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  // World-unit width the editor should occupy, or 'auto' to fill its styled
  // container (sticky notes size the textarea in CSS).
  width: number | 'auto';
  // Called after every local commit that changed the text, so text objects
  // can re-measure their box.
  onInput?(): void;
  onEnd(next: EndEditNext): void;
  undo?: UndoController;
  testId: string;
  className: string;
  renderCounter?(length: number): JSX.Element | null;
}

// Generalised story 2 editor: a plain textarea diffed into the Y.Text on
// every input event, IME composition skipped until compositionend, caret at
// the end on mount, Escape or an outside pointerdown ends editing, Ctrl/Cmd+Z
// routed to the shared undo stack. Sticky notes and text objects share it so
// concurrent typing merges identically (text.concurrent).
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
  testId,
  className,
  renderCounter
}: TextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);
  const commitRef = useRef<(raw: string) => void>(() => {});
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.value = ytext.toString();
    // Mount and unmount bound the typing session, so text typed in two
    // separate sessions never merges into one undo step.
    undoRef.current?.boundary();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    return () => {
      const current = textareaRef.current;
      if (current !== null) commitRef.current(current.value);
      undoRef.current?.boundary();
    };
  }, [ytext]);

  useEffect(() => {
    // Undo or a remote peer rewrote the text: mirror it into the textarea.
    // Our own keystrokes (LOCAL_ORIGIN) are already in the DOM.
    const onTextChange = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      const el = textareaRef.current;
      if (el === null) return;
      const next = ytext.toString();
      el.value = next;
      setLength(next.length);
    };
    ytext.observe(onTextChange);
    return () => ytext.unobserve(onTextChange);
  }, [ytext]);

  const commit = (raw: string) => {
    const el = textareaRef.current;
    const clamped = clampToLimit(raw, maxChars);
    if (el !== null && clamped !== raw) {
      el.value = clamped;
      // Caret goes back to the end of the kept text after a truncation.
      el.setSelectionRange(clamped.length, clamped.length);
    }
    const changed = ytext.toString() !== clamped;
    if (changed) {
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    }
    setLength(clamped.length);
    if (changed) onInputRef.current?.();
  };
  commitRef.current = commit;

  useEffect(() => {
    // Pointerdown anywhere outside the textarea ends editing.
    // Capture phase so object/toolbar stopPropagation cannot hide the click.
    const onPointerDown = (e: PointerEvent) => {
      const el = textareaRef.current;
      if (el === null) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      commit(el.value);
      onEnd('unselected');
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEnd]);

  return (
    <>
      <textarea
        ref={textareaRef}
        data-testid={testId}
        className={className}
        style={{
          fontSize: fontPx,
          ...(width === 'auto' ? undefined : { width })
        }}
        onInput={(e) => {
          if (composingRef.current) return;
          commit(e.currentTarget.value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          const controller = undoRef.current;
          if (
            controller !== undefined &&
            (e.ctrlKey || e.metaKey) &&
            (e.key === 'z' || e.key === 'Z')
          ) {
            // The editor owns keys, so route undo/redo to the shared stack
            // instead of the textarea's native history.
            e.stopPropagation();
            const direction = e.shiftKey ? controller.redo : controller.undo;
            const available = e.shiftKey ? controller.canRedo() : controller.canUndo();
            if (available) {
              e.preventDefault();
              direction();
            }
            return;
          }
          if (controller !== undefined && e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
            e.stopPropagation();
            if (controller.canRedo()) {
              e.preventDefault();
              controller.redo();
            }
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            commit(e.currentTarget.value);
            onEnd('selected');
          }
          // Enter is not intercepted: the textarea inserts a new line.
        }}
        onBlur={(e) => {
          // Defensive flush; text may exist without a blur event (deleted).
          commit(e.currentTarget.value);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
      />
      {renderCounter?.(length)}
    </>
  );
}
