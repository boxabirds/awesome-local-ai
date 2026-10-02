import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD } from '../../shared/config';
import { fitFontSize } from './StickyText';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  /** The shared text of the object being edited. */
  ytext: Y.Text;
  /** Hard character limit; extra input is dropped (TEXT_MAX_CHARS / STICKY_TEXT_MAX_CHARS). */
  maxChars: number;
  /** Font size in board units. */
  fontPx: number;
  /** Box width in board units, or `'auto'` to size to the content. */
  width: number | 'auto';
  /** Called after every written change so the caller can re-measure the box. */
  onInput(): void;
  /** Editing finished: keep the object selected or drop the selection. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Story 8 undo controller: boundaries on start/end, Ctrl/Cmd+Z routed to it. */
  undo?: UndoController;
  /** Story 2 sticky notes fit their font to the note's box. */
  autoFit?: boolean;
  /** Rendered next to the textarea (story 2’s character counter). */
  counter?: (length: number) => React.ReactNode;
  /** `data-testid` of the textarea. */
  testId?: string;
  /** Selector of the surrounding object; a press outside it ends editing. */
  containerSelector?: string;
  /** Extra styles merged last (colour, alignment, insets, line height). */
  style?: React.CSSProperties;
}

/**
 * The shared text editor of editable objects (story 2 sticky notes, story 9
 * text objects). Every `input` is written to the shared `Y.Text` immediately
 * with a minimal diff, so finishing editing writes nothing further. IME
 * composition is deferred to `compositionend` so composition input never
 * duplicates characters. Enter inserts a new line; Escape ends editing;
 * Ctrl/Cmd+Z goes to the board's undo controller rather than the textarea's own
 * history, which would diverge from the shared document.
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
  autoFit = false,
  counter,
  testId = 'text-editor',
  containerSelector = '[data-object-id]',
  style,
}: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const [length, setLength] = useState(() => ytext.toString().length);

  const fit = useCallback(() => {
    if (!autoFit) return;
    const el = ref.current;
    if (!el) return;
    // The box is in board units, the same units the world layer is drawn in.
    const box = el.clientHeight > 0 ? el.clientHeight : Number.POSITIVE_INFINITY;
    fitFontSize(el, box);
  }, [autoFit]);

  const flush = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value, maxChars);
    if (clamped !== el.value) {
      // Characters beyond the limit are dropped; the caret stays at the end of
      // the text that was kept.
      const caret = Math.min(el.selectionStart ?? clamped.length, clamped.length);
      el.value = clamped;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* jsdom */
      }
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    setLength(el.value.length);
    fit();
    onInputRef.current();
  }, [ytext, maxChars, fit]);

  // Edit start boundary: closes any open capture window from a prior action.
  useEffect(() => {
    undoRef.current?.boundary();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Edit start: value from the document, focus, caret at the end of the text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const text = ytext.toString();
    el.value = text;
    setLength(text.length);
    el.focus();
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {
      /* jsdom */
    }
    fit();
  }, [ytext, fit]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return; // written on compositionend instead
    flush();
  }, [flush]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    flush();
  }, [flush]);

  const finish = useCallback(
    (next: 'selected' | 'unselected') => {
      if (endedRef.current) return;
      endedRef.current = true;
      flush();
      onEndRef.current(next);
    },
    [flush],
  );

  // Bring the textarea back in line with the document after an undo/redo.
  const syncFromDoc = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    setLength(el.value.length);
  }, [ytext]);

  // Someone else typed into the same object: show their characters now, keeping
  // this caret the same distance from the end. Without this, the next diff
  // would be computed against a stale value and drop their characters.
  useEffect(() => {
    const observer = (
      _events: Y.YEvent<Y.AbstractType<unknown>>[],
      transaction: Y.Transaction,
    ) => {
      if (transaction.origin === LOCAL_ORIGIN) return; // our own write, already in the value
      if (composingRef.current) return; // never disturb an in-progress IME session
      const el = ref.current;
      if (!el) return;
      const next = ytext.toString();
      const fromEnd = Math.max(0, el.value.length - (el.selectionStart ?? el.value.length));
      el.value = next;
      setLength(next.length);
      const caret = Math.max(0, next.length - fromEnd);
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* jsdom */
      }
      fit();
    };
    ytext.observeDeep(observer);
    return () => ytext.unobserveDeep(observer);
  }, [ytext, fit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish('selected');
        return;
      }
      const controller = undoRef.current;
      if (controller) {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          controller.undo();
          syncFromDoc();
          return;
        }
        if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          controller.redo();
          syncFromDoc();
          return;
        }
        if (e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
          e.preventDefault();
          controller.redo();
          syncFromDoc();
          return;
        }
      }
      // Enter is left to the textarea, which inserts a new line.
    },
    [finish, syncFromDoc],
  );

  // A pointerdown anywhere outside the object ends editing and clears selection.
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (el.contains(target)) return;
      const object = el.closest(containerSelector);
      if (object && object.contains(target)) return;
      finish('unselected');
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [finish, containerSelector]);

  // End-edit boundary: close capture window when the editor unmounts.
  useEffect(() => {
    return () => {
      undoRef.current?.boundary();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const auto = width === 'auto';

  return (
    <>
      <textarea
        ref={ref}
        data-testid={testId}
        defaultValue=""
        spellCheck={false}
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={flush}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: 'auto',
          ...(auto
            ? { width: 'max-content', minWidth: 1, maxWidth: TEXT_MAX_AUTO_WIDTH_WORLD }
            : { width }),
          padding: 0,
          margin: 0,
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          background: 'transparent',
          color: '#1f1f1f',
          caretColor: '#1f1f1f',
          fontFamily: TEXT_FONT_FAMILY,
          lineHeight: TEXT_LINE_HEIGHT,
          fontSize: fontPx,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          ...style,
        }}
      />
      {counter ? counter(length) : null}
    </>
  );
}
