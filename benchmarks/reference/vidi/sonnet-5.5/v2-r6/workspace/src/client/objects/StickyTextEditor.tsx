import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampEdit, counterVisible } from './StickyText';

export function StickyTextEditor(props: {
  ytext: Y.Text; fontPx: number; onEnd(next: 'selected' | 'unselected'): void;
}) {
  const { ytext, fontPx, onEnd } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [length, setLength] = useState(() => ytext.length);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const text = ytext.toString();
    el.value = text;
    el.focus();
    el.setSelectionRange(text.length, text.length);
  }, [ytext]);

  // A pointerdown anywhere outside the note ends editing.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const note = ref.current?.closest('[data-sticky-note]');
      if (note && e.target instanceof Node && note.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const sync = () => {
    const el = ref.current;
    // The note may have been deleted meanwhile: never write to a removed Y.Text.
    if (!el || (ytext as unknown as { _item?: { deleted: boolean } })._item?.deleted) return;
    const prev = ytext.toString();
    const { value, caret } = clampEdit(prev, el.value, STICKY_TEXT_MAX_CHARS);
    if (value !== el.value) {
      el.value = value;
      el.setSelectionRange(caret, caret);
    }
    applyTextDiff(ytext, value, LOCAL_ORIGIN);
    setLength(value.length);
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-editor"
        aria-label="Note text"
        style={{ fontSize: fontPx }}
        spellCheck={false}
        onInput={() => { if (!composing.current) sync(); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; sync(); }}
        onBlur={() => { if (!composing.current) sync(); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onEnd('selected');
          }
        }}
      />
      {counterVisible(length) && (
        <span className="sticky-counter">{length}/{STICKY_TEXT_MAX_CHARS}</span>
      )}
    </>
  );
}
