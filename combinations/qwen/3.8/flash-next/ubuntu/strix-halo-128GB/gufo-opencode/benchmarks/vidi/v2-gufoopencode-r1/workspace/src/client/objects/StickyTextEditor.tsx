import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, FormEvent as ReactFormEvent, JSX } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize } from './StickyText';
import { editorStyle, STICKY_TEXT_BOX_WORLD } from './stickyStyles';
import { useUndoController } from '../board/useUndo';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, onEnd } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [fontPx, setFontPx] = useState(props.fontPx);
  const [length, setLength] = useState(() => ytext.toString().length);
  const undo = useUndoController();

  // An editing session is one undo step: close the previous step on mount and
  // the typing burst (merged by the capture timeout) on unmount.
  useEffect(() => {
    undo?.boundary();
    return () => {
      undo?.boundary();
    };
  }, [undo]);

  const fit = (): void => {
    const el = textareaRef.current;
    if (el === null) return;
    setFontPx(fitFontSize(el, STICKY_TEXT_BOX_WORLD).fontPx);
  };

  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus and place the caret at the end of the existing text on mount.
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  const commit = (raw: string): void => {
    const clamped = clampToLimit(raw);
    const el = textareaRef.current;
    if (el !== null && el.value !== clamped) {
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    setLength(clamped.length);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    fit();
  };

  // Remote edits landing in this Y.Text while the textarea holds the local
  // value are spliced into the textarea around the local caret instead of
  // overwriting it: the changed region is located by its common prefix and
  // suffix, and the caret is shifted by whatever the remote inserted or
  // removed relative to it. (A story-2 minimal textarea kept the stale local
  // value and the next commit's diff would silently delete remote text.)
  useEffect(() => {
    let last = ytext.toString();
    const observer = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      const next = ytext.toString();
      const prev = last;
      last = next;
      setLength(next.length);
      const el = textareaRef.current;
      if (transaction.origin === LOCAL_ORIGIN || el === null || composingRef.current) {
        if (composingRef.current) fit();
        return;
      }
      let p = 0;
      const maxPrefix = Math.min(prev.length, next.length);
      while (p < maxPrefix && prev[p] === next[p]) p += 1;
      let s = 0;
      const maxSuffix = Math.min(prev.length - p, next.length - p);
      while (s < maxSuffix && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s += 1;
      const oldInner = prev.slice(p, prev.length - s);
      const newInner = next.slice(p, next.length - s);
      const mapCaret = (caret: number): number =>
        caret <= p
          ? caret
          : caret >= p + oldInner.length
            ? caret + (newInner.length - oldInner.length)
            : p + newInner.length;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = next;
      el.setSelectionRange(mapCaret(start), mapCaret(end));
      fit();
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytext]);

  const onInput = (event: ReactFormEvent<HTMLTextAreaElement>): void => {
    if (composingRef.current) return;
    commit(event.currentTarget.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEnd('selected');
      return;
    }
    // Undo/redo inside the textarea must drive the Y.Doc history, not the
    // browser's native textarea undo (which would diverge from Y.Text).
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 'z' || event.key === 'Z' || event.key === 'y' || event.key === 'Y')) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'z' || event.key === 'Z') {
        if (event.shiftKey) undo?.redo();
        else undo?.undo();
      } else {
        undo?.redo();
      }
    }
    // Enter inserts a newline (default textarea behaviour); other keys pass
    // through to edit text.
  };

  const onBlur = (): void => {
    if (composingRef.current) return;
    const el = textareaRef.current;
    if (el === null || ytext.doc === null) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== ytext.toString()) applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
  };

  return (
    <>
      <textarea
        ref={textareaRef}
        data-testid="sticky-editor"
        aria-label="Sticky note text"
        defaultValue={ytext.toString()}
        style={{ ...editorStyle, fontSize: fontPx }}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          commit(event.currentTarget.value);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      />
      {counterVisible(length) ? (
        <output
          data-testid="sticky-counter"
          aria-live="polite"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 4,
            fontSize: 11,
            color: '#6b7280',
            pointerEvents: 'none'
          }}
        >
          {length}/{STICKY_TEXT_MAX_CHARS}
        </output>
      ) : null}
    </>
  );
}
