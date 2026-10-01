import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}) {
  const { ytext, onEnd } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [length, setLength] = useState(() => ytext.length);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    setLength(el.value.length);
    const onRemote = () => {
      const text = ytext.toString();
      if (composing.current || el.value === text) return;
      el.value = text;
      setLength(text.length);
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
  }, [ytext]);

  // A pointerdown anywhere outside the note ends editing (capture phase: notes stop propagation).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const note = ref.current?.closest('[data-sticky-note]');
      if (note && e.target instanceof Node && note.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const flush = () => {
    const el = ref.current;
    if (!el || composing.current) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    setLength(clamped.length);
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-editor"
        aria-label="Note text"
        style={{ fontSize: props.fontPx }}
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
          if (e.key === 'Escape') {
            e.preventDefault();
            onEnd('selected');
          }
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
