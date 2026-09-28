import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, counterVisible, limitEdit, transformIndex } from './StickyText';

/** True once the Y.Text has been removed from the document (its note was deleted). */
function isDetached(ytext: Y.Text): boolean {
  return ytext.doc === null || ytext._item?.deleted === true;
}

/**
 * In-place textarea for a note's text. Every input is written straight to the Y.Text with a minimal diff,
 * so ending editing (Escape, pointerdown outside the note) needs no extra write and cannot lose text.
 * `paddingTop` lines the text up with the vertically centred display text.
 */
export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  paddingTop?: number;
  onEnd(next: 'selected' | 'unselected'): void;
}) {
  const { ytext } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.length);
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;

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

  // A press anywhere outside this note ends editing. Capture phase, so it runs before anything that
  // handles the press (the board, another note, a toolbar button).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const ta = ref.current;
      if (!ta) return;
      const note = ta.closest('[data-note-id]') ?? ta;
      if (e.target instanceof Node && note.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const commit = () => {
    const ta = ref.current;
    if (!ta || composingRef.current || isDetached(ytext)) return;
    const { value, caret } = limitEdit(ytext.toString(), ta.value);
    if (value !== ta.value) {
      ta.value = value;
      if (caret !== null) ta.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, value, LOCAL_ORIGIN);
    setLength(value.length);
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-note__editor"
        aria-label="Note text"
        spellCheck
        style={{ fontSize: `${props.fontPx}px`, paddingTop: props.paddingTop }}
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
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            commit();
            onEndRef.current('selected');
          }
        }}
      />
      {counterVisible(length) && (
        <div className="sticky-note__counter" data-testid="note-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
