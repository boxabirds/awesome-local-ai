import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible, transformIndex } from './StickyText';

export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}) {
  const { ytext, fontPx } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const onEnd = useRef(props.onEnd);
  onEnd.current = props.onEnd;
  const [length, setLength] = useState(() => ytext.length);

  // Mount: value from Y.Text, focus, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const text = ytext.toString();
    el.value = text;
    setLength(text.length);
    el.focus();
    el.setSelectionRange(text.length, text.length);
  }, [ytext]);

  // Changes made by other people while this editor is open: show them and keep the caret where it was
  // relative to the surrounding text. Without this the next keystroke would diff a stale textarea against
  // the merged text and delete what the others typed.
  useEffect(() => {
    const onRemote = (event: Y.YTextEvent, tr: Y.Transaction) => {
      const el = ref.current;
      if (!el || tr.origin === LOCAL_ORIGIN) return;
      const focused = document.activeElement === el;
      const start = transformIndex(event.delta, el.selectionStart);
      const end = transformIndex(event.delta, el.selectionEnd);
      const text = ytext.toString();
      el.value = text;
      if (focused) el.setSelectionRange(start, end);
      setLength(text.length);
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
  }, [ytext]);

  // A pointerdown anywhere outside the note ends editing.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const note = ref.current?.closest('[data-sticky-note]');
      if (note && e.target instanceof Node && note.contains(e.target)) return;
      onEnd.current('unselected');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const sync = (el: HTMLTextAreaElement) => {
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    setLength(clamped.length);
  };

  const onInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (composing.current) return;
    sync(e.currentTarget);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEnd.current('selected');
    }
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-textarea"
        aria-label="Sticky note text"
        style={{ fontSize: fontPx }}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          sync(e.currentTarget);
        }}
        onBlur={(e) => {
          if (!composing.current) sync(e.currentTarget);
        }}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" aria-live="polite">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </>
  );
}
