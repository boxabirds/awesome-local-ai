/**
 * Generalised in-place text editor (story 2 for sticky notes, story 9 for free
 * text). One textarea, one `Y.Text`: every `input` is written with a minimal
 * diff so a concurrent typist is never overwritten, input is clamped to the
 * type's character limit, Enter inserts a new line and Escape or a click
 * outside ends editing.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Characters kept when the value would grow past this limit. */
  maxChars: number;
  /** Font size in board units. */
  fontPx: number;
  /** Box width in board units, or 'auto' to follow the container. */
  width: number | 'auto';
  /** Called after every written input (text objects re-measure their box). */
  onInput?(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Undo controller: Ctrl/Cmd+Z inside the editor drives the board history. */
  undo?: UndoController;
  /** Extra styles merged last (sticky notes use insets and centred text). */
  style?: React.CSSProperties;
  /** Called on mount and after every input (sticky notes re-fit their font). */
  fit?(el: HTMLTextAreaElement): void;
  /** Optional character counter rendered beside the textarea. */
  counter?(length: number): React.ReactNode;
  testId?: string;
  fontFamily?: string;
  lineHeight?: number | string;
}

const BASE_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  padding: 0,
  margin: 0,
  border: 'none',
  outline: 'none',
  resize: 'none',
  overflow: 'hidden',
  background: 'transparent',
  color: '#1f1f1f',
  caretColor: '#1f1f1f',
  fontFamily: 'inherit',
  lineHeight: 1.25,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

/**
 * The textarea shown while an object with text is being edited. IME
 * composition is deferred to `compositionend` so composition input never
 * duplicates characters.
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
  style,
  fit,
  counter,
  testId = 'text-editor',
  fontFamily,
  lineHeight,
}: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const [length, setLength] = useState(() => ytext.toString().length);

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
    fitRef.current?.(el);
    onInputRef.current?.();
  }, [ytext, maxChars]);

  // Edit start boundary: closes any open capture window from a prior action.
  useEffect(() => {
    undo?.boundary();
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
    fitRef.current?.(el);
  }, [ytext]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish('selected');
        return;
      }
      // Intercept Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y so the native textarea
      // undo never diverges from the shared Y.Text.
      if (undo) {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          undo.undo();
          const el = ref.current;
          if (el) {
            el.value = ytext.toString();
            setLength(el.value.length);
          }
          return;
        }
        if (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          undo.redo();
          const el = ref.current;
          if (el) {
            el.value = ytext.toString();
            setLength(el.value.length);
          }
          return;
        }
        if (e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
          e.preventDefault();
          undo.redo();
          const el = ref.current;
          if (el) {
            el.value = ytext.toString();
            setLength(el.value.length);
          }
          return;
        }
      }
      // Enter is left to the textarea, which inserts a new line.
    },
    [finish, undo, ytext],
  );

  // A pointerdown anywhere outside the object ends editing.
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (!target) return;
      const owner = el.closest('[data-object-id]');
      if (owner && owner.contains(target)) return;
      if (el.contains(target)) return;
      // The floating board UI (selection toolbar) acts *on* the object being
      // edited: clicking a colour or a size keeps the edit open.
      if ((target as HTMLElement).closest?.('[data-editor-ui]')) return;
      finish('unselected');
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [finish]);

  // End-edit boundary: close the capture window when the editor unmounts.
  useEffect(() => {
    return () => {
      undo?.boundary();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sizeStyle: React.CSSProperties =
    width === 'auto' ? {} : { width, height: '100%', minWidth: width };

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
          ...BASE_STYLE,
          ...sizeStyle,
          fontSize: fontPx,
          fontFamily,
          lineHeight,
          ...style,
        }}
      />
      {counter?.(length)}
    </>
  );
}
