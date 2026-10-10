// Text editing for one sticky note: a textarea whose every input is written
// to the shared Y.Text with the minimal diff. Ending editing performs no
// additional write because each input event was already applied.

import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import type { UndoController } from '../board/undo';
import {
  STICKY_TEXT_BOX_WORLD,
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
} from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  undo?: UndoController;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor({
  ytext,
  fontPx,
  undo,
  onEnd,
}: StickyTextEditorProps): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const [length, setLength] = useState(() => ytext.toString().length);

  // Editing is its own undo step: boundaries open and close it (undo.boundaries).
  useEffect(() => {
    undoRef.current?.boundary();
    return () => undoRef.current?.boundary();
  }, [ytext]);

  // Start editing (sticky.edit_start): value from Y.Text, focus, caret at end.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    setLength(len);
  }, [ytext]);

  // Mirror remote edits into the textarea while typing (story 3: concurrent
  // editors). Caret is kept at the same distance from the text end so typing
  // at the end stays at the end while remote characters arrive.
  useEffect(() => {
    const observer = (event: Y.YTextEvent, txn: Y.Transaction): void => {
      if (txn.origin === LOCAL_ORIGIN) return;
      const el = ref.current;
      if (!el) return;
      const next = ytext.toString();
      if (!composingRef.current) {
        const oldLen = el.value.length;
        const selStart = el.selectionStart ?? oldLen;
        const selEnd = el.selectionEnd ?? oldLen;
        el.value = next;
        const clamp = (fromEnd: number): number =>
          Math.max(0, Math.min(next.length, next.length - fromEnd));
        const a = clamp(oldLen - selStart);
        const f = clamp(oldLen - selEnd);
        el.setSelectionRange(Math.min(a, f), Math.max(a, f));
        fitFontSize(el, STICKY_TEXT_BOX_WORLD);
      }
      setLength(next.length);
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  // Click outside the note ends editing unselected (sticky.edit_end).
  useEffect(() => {
    const onWindowPointerDown = (e: PointerEvent) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      if (e.target instanceof Node && wrap.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    window.addEventListener('pointerdown', onWindowPointerDown, true);
    return () => window.removeEventListener('pointerdown', onWindowPointerDown, true);
  }, []);

  const flush = (): void => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      // Characters beyond the limit are dropped; caret goes to end of kept text.
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    setLength(el.value.length);
    fitFontSize(el, STICKY_TEXT_BOX_WORLD);
  };

  return (
    <div className="sticky-editor" ref={wrapRef} onPointerDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        className="sticky-textarea"
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
        style={{ fontSize: fontPx }}
        defaultValue=""
        spellCheck={false}
        onInput={() => {
          if (!composingRef.current) flush();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          flush();
        }}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
            // Native textarea undo would diverge from Y.Text: route to the
            // controller (undo.boundaries). The observer above mirrors the
            // result back into the textarea (origin is the manager, not us).
            e.preventDefault();
            e.stopPropagation();
            flush();
            const controller = undoRef.current;
            if (!controller) return;
            if (e.key === 'y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
              controller.redo();
            } else {
              controller.undo();
            }
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            ref.current?.blur();
            onEndRef.current('selected');
          }
        }}
        onBlur={flush}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" data-testid="sticky-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
