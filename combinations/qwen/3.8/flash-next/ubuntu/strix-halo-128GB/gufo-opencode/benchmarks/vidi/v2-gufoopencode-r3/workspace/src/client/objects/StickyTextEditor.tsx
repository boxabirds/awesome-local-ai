import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import type { UndoController } from '../board/undo';
import { applyTextDiff, clampToLimit, counterVisible, type EndEditNext } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: EndEditNext): void;
  // This tab's undo history. Absent means Ctrl+Z keeps the browser default.
  undo?: UndoController;
}

// Plain textarea diffed into the Y.Text on every input event, so ending
// editing never needs an extra write. IME composition is skipped until
// compositionend to avoid duplicating characters.
export function StickyTextEditor({ ytext, fontPx, onEnd, undo }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);
  const commitRef = useRef<(raw: string) => void>(() => {});
  const undoRef = useRef(undo);
  undoRef.current = undo;

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
    const clamped = clampToLimit(raw);
    if (el !== null && clamped !== raw) {
      el.value = clamped;
      // Caret goes back to the end of the kept text after a truncation.
      el.setSelectionRange(clamped.length, clamped.length);
    }
    if (ytext.toString() !== clamped) {
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    }
    setLength(clamped.length);
  };
  commitRef.current = commit;

  useEffect(() => {
    // Pointerdown anywhere outside the textarea ends editing unselected.
    // Capture phase so note/toolbar stopPropagation cannot hide the click.
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
        data-testid="sticky-textarea"
        className="sticky-textarea"
        style={{ fontSize: fontPx }}
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
          if (controller !== undefined && (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
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
          // Defensive flush; text may exist without a blur event (note deleted).
          commit(e.currentTarget.value);
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" data-testid="sticky-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </>
  );
}
