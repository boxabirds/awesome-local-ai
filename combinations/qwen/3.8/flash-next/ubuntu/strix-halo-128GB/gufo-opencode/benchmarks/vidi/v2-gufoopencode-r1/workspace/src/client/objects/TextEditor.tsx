import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, FormEvent as ReactFormEvent, JSX, CSSProperties } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from '../../shared/config';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { useUndoController } from '../board/useUndo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number;
  testId: string;
  onInput?(): void;
  // Runs inside the same transaction as the committed edit, so a keystroke
  // is a single Yjs transaction (text + derived box) and observers see one
  // event round.
  onCommit?(): void;
  onEnd(next: 'selected' | 'unselected'): void;
}

// Generalized inline editor (design text.editor): story 2's sticky editor with
// the sticky-specific fit-to-box and counter removed. An editing session is
// one undo step; Escape ends it, remote edits splice around the local caret.
export function TextEditor(props: TextEditorProps): JSX.Element {
  const { ytext, maxChars, onEnd } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const undo = useUndoController();

  useEffect(() => {
    undo?.boundary();
    return () => {
      undo?.boundary();
    };
  }, [undo]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  const commit = (raw: string): void => {
    const clamped = clampToLimit(raw, maxChars);
    const el = textareaRef.current;
    if (el !== null && el.value !== clamped) {
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    const doc = ytext.doc as Y.Doc | null | undefined;
    if (doc !== null && doc !== undefined && props.onCommit !== undefined) {
      doc.transact(() => {
        applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
        props.onCommit?.();
      }, LOCAL_ORIGIN);
    } else {
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
      props.onCommit?.();
    }
    props.onInput?.();
  };

  // Remote edits are spliced into the textarea around the local caret (same
  // prefix/suffix strategy as the sticky editor).
  useEffect(() => {
    let last = ytext.toString();
    const observer = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      const next = ytext.toString();
      const prev = last;
      last = next;
      const el = textareaRef.current;
      if (transaction.origin === LOCAL_ORIGIN || el === null || composingRef.current) return;
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
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      (event.key === 'z' || event.key === 'Z' || event.key === 'y' || event.key === 'Y')
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'z' || event.key === 'Z') {
        if (event.shiftKey) undo?.redo();
        else undo?.undo();
      } else {
        undo?.redo();
      }
    }
  };

  const onBlur = (): void => {
    if (composingRef.current) return;
    const el = textareaRef.current;
    if (el === null || ytext.doc === null) return;
    const clamped = clampToLimit(el.value, maxChars);
    if (clamped !== ytext.toString()) applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
  };

  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    margin: 0,
    padding: 0,
    border: 'none',
    outline: 'none',
    resize: 'none',
    overflow: 'hidden',
    background: 'transparent',
    color: '#1f2937',
    fontFamily: TEXT_FONT_FAMILY,
    fontSize: props.fontPx,
    lineHeight: String(TEXT_LINE_HEIGHT)
  };

  return (
    <textarea
      ref={textareaRef}
      data-testid={props.testId}
      aria-label="Text"
      defaultValue={ytext.toString()}
      style={style}
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
  );
}
