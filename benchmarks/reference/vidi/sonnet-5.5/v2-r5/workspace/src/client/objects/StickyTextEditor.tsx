import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

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
    el.value = ytext.toString();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // A pointerdown outside the note (the textarea's [data-sticky] ancestor) ends editing.
    const onDown = (e: PointerEvent) => {
      const host = el.closest('[data-sticky]');
      if (host && e.target instanceof Node && host.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDown, true);
    // Remote edits are mirrored into the textarea; the caret is carried through the delta.
    const onRemote = (event: Y.YTextEvent, tr: Y.Transaction) => {
      if (tr.origin === LOCAL_ORIGIN) return;
      let start = el.selectionStart;
      let end = el.selectionEnd;
      let pos = 0;
      const shift = (sel: number, op: { insert?: unknown; retain?: number; delete?: number }) => {
        if (typeof op.insert === 'string') return pos <= sel ? sel + op.insert.length : sel;
        if (op.delete) return pos < sel ? sel - Math.min(op.delete, sel - pos) : sel;
        return sel;
      };
      for (const op of event.delta) {
        start = shift(start, op);
        end = shift(end, op);
        if (typeof op.insert === 'string') pos += op.insert.length;
        else if (op.retain) pos += op.retain;
      }
      el.value = ytext.toString();
      el.setSelectionRange(start, end);
      setLength(el.value.length);
    };
    ytext.observe(onRemote);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      ytext.unobserve(onRemote);
    };
  }, [ytext]);

  const flush = () => {
    const el = ref.current;
    if (!el || !ytext.doc) return;
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
        style={{ fontSize: fontPx }}
        onInput={() => { if (!composing.current) flush(); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; flush(); }}
        onBlur={() => { if (!composing.current) flush(); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onEnd('selected');
          }
        }}
      />
      {counterVisible(length) && (
        <span className="sticky-counter" data-testid="sticky-counter">{length}/{STICKY_TEXT_MAX_CHARS}</span>
      )}
    </>
  );
}
