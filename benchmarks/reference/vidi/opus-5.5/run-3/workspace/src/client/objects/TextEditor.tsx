import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, limitEdit, transformIndex } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

/** True once the Y.Text has been removed from the document (its note was deleted). */
function isDetached(ytext: Y.Text): boolean {
  return ytext.doc === null || ytext._item?.deleted === true;
}

/**
 * In-place textarea for an object's text (sticky notes, text objects). Every input is written straight to the
 * Y.Text with a minimal diff, clamped to `maxChars`, so ending editing (Escape, pointerdown outside the object)
 * needs no extra write and cannot lose text. `onInput` runs after each local change (text objects re-measure).
 * Enter inserts a new line. The object is the closest `[data-object-id]` ancestor.
 *
 * Undo (story 8): editing starts and ends an undo step boundary; typing in between groups into bursts by the
 * capture timeout. Ctrl/Cmd+Z here undoes only typing done since editing started (never earlier actions),
 * through the shared history, so the browser's own textarea undo never diverges from the Y.Text.
 */
export function TextEditor(props: {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  /** A width in world units, or 'auto' to fill the object. */
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undo: UndoController;
  className?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  /** Extra content after the textarea (the note's character counter), given the current length. */
  renderExtra?(length: number): ReactNode;
}) {
  const { ytext, undo, maxChars } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.length);
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;
  const onInputRef = useRef(props.onInput);
  onInputRef.current = props.onInput;
  // The steps on top of the stacks when editing started: in-editor undo and redo never go past them.
  const marksRef = useRef<{ undo: object | null; redo: object | null }>({ undo: null, redo: null });

  useEffect(() => {
    undo.boundary();
    marksRef.current = { undo: undo.topUndo(), redo: undo.topRedo() };
    return () => undo.boundary();
  }, [undo]);

  // Start editing: current text, focused, caret at the end.
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    const value = ytext.toString();
    ta.value = value;
    setLength(value.length);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(value.length, value.length);
  }, [ytext]);

  // Changes to the text that did not come from this textarea (other people, from story 3).
  useEffect(() => {
    const onChange = (event: Y.YTextEvent) => {
      const ta = ref.current;
      if (!ta || composingRef.current) return;
      const value = ytext.toString();
      if (ta.value === value) return;
      // Keep the caret (and selection) next to the same characters while others type elsewhere.
      const delta = event.changes.delta;
      const start = Math.min(transformIndex(delta, ta.selectionStart), value.length);
      const end = Math.min(transformIndex(delta, ta.selectionEnd), value.length);
      const focused = document.activeElement === ta;
      ta.value = value;
      if (focused) ta.setSelectionRange(start, Math.max(start, end));
      setLength(value.length);
    };
    ytext.observe(onChange);
    return () => ytext.unobserve(onChange);
  }, [ytext]);

  // A press anywhere outside this object ends editing. Capture phase, so it runs before anything that
  // handles the press (the board, another note, a toolbar button).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const ta = ref.current;
      if (!ta) return;
      const owner = ta.closest('[data-object-id]') ?? ta;
      if (e.target instanceof Node && owner.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const commit = () => {
    const ta = ref.current;
    if (!ta || composingRef.current || isDetached(ytext)) return;
    const prev = ytext.toString();
    const { value, caret } = limitEdit(prev, ta.value, maxChars);
    if (value !== ta.value) {
      ta.value = value;
      if (caret !== null) ta.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, value, LOCAL_ORIGIN);
    setLength(value.length);
    if (value !== prev) onInputRef.current();
  };

  return (
    <>
      <textarea
        ref={ref}
        className={props.className}
        aria-label={props.ariaLabel}
        spellCheck
        style={{
          ...props.style,
          fontSize: `${props.fontPx}px`,
          width: props.width === 'auto' ? undefined : props.width,
        }}
        onInput={(e) => {
          if ((e.nativeEvent as InputEvent).isComposing) return;
          commit();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          commit();
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          const k = e.key.toLowerCase();
          const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
          const isUndo = mod && k === 'z' && !e.shiftKey;
          const isRedo = mod && ((k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey && !e.shiftKey));
          if (isUndo || isRedo) {
            e.preventDefault();
            e.stopPropagation();
            if (composingRef.current) return;
            commit();
            if (isUndo) {
              if (undo.canUndo() && undo.topUndo() !== marksRef.current.undo) undo.undo();
            } else if (undo.canRedo() && undo.topRedo() !== marksRef.current.redo) {
              undo.redo();
            }
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            commit();
            onEndRef.current('selected');
          }
        }}
      />
      {props.renderExtra?.(length)}
    </>
  );
}
