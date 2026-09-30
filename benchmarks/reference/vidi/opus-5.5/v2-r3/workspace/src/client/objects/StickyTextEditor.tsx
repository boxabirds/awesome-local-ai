import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, counterVisible, limitEdit } from './StickyText';

/**
 * Textarea editing one note's Y.Text. Every input event is written straight to
 * the Y.Text with a minimal diff, so ending editing needs no extra write.
 * Ends on Escape ('selected') or a pointerdown outside the note ('unselected').
 */
export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Top padding (board units) that vertically centres short text like the display mode. */
  padTop?: number;
}) {
  const { ytext } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.length);
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;

  // Edit start: current text, focused, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current!;
    const value = ytext.toString();
    el.value = value;
    el.focus({ preventScroll: true });
    el.setSelectionRange(value.length, value.length);
    setLength(value.length);
  }, [ytext]);

  // A pointerdown anywhere outside this note ends editing.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const note = el.closest('[data-note-id]') ?? el;
      if (e.target instanceof Node && note.contains(e.target)) return;
      flush();
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  /** Writes the textarea value to the Y.Text, enforcing the length limit. */
  function flush() {
    const el = ref.current;
    if (!el || composingRef.current) return;
    // The note may have been deleted meanwhile; never write to a detached text.
    if (ytext.doc === null || ytext._item?.deleted) return;
    const limited = limitEdit(ytext.toString(), el.value);
    if (limited) {
      el.value = limited.text;
      el.setSelectionRange(limited.caret, limited.caret);
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    setLength(el.value.length);
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      flush();
      props.onEnd('selected');
    }
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-editor"
        aria-label="Note text"
        spellCheck
        style={{ fontSize: `${props.fontPx}px`, paddingTop: props.padTop }}
        onInput={flush}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          flush();
        }}
        onBlur={flush}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
