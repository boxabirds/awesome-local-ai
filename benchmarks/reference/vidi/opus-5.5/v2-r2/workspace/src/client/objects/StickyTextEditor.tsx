import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { STICKY_LINE_HEIGHT, STICKY_PADDING_WORLD, applyTextDiff, clampEdit, counterVisible } from './StickyText';

/** A Y.Text whose note has been deleted must not be written to. */
function isDetached(ytext: Y.Text): boolean {
  return ytext.doc === null || ytext._item?.deleted === true;
}

/**
 * Textarea editor for one sticky note. Every input is written to `ytext`
 * immediately (minimal diff), so ending editing never needs another write.
 */
export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}): React.JSX.Element {
  const { ytext } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [length, setLength] = useState(() => ytext.length);
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;

  // Edit start: current text, focused, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [ytext]);

  // Any pointerdown outside this note ends editing.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const note = ref.current?.closest('[data-sticky-note]') ?? ref.current;
      if (note && e.target instanceof Node && note.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const commit = () => {
    const el = ref.current;
    if (!el || composing.current || isDetached(ytext)) return;
    const prev = ytext.toString();
    const { text, caret } = clampEdit(prev, el.value);
    if (text !== el.value) {
      el.value = text;
      if (caret !== null) el.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, text, LOCAL_ORIGIN);
    setLength(text.length);
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-editor"
        aria-label="Sticky note text"
        spellCheck
        style={{
          fontSize: `${props.fontPx}px`,
          lineHeight: STICKY_LINE_HEIGHT,
          padding: `0 ${STICKY_PADDING_WORLD}px`,
        }}
        onInput={commit}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          commit();
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            commit();
            props.onEnd('selected');
          }
        }}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
