import { useRef, useEffect, useState } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { TEXT_FONT_FAMILY } from '../../shared/config';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  /** Width in world units, or 'auto' for auto-width. */
  width: number | 'auto';
  onInput: () => void;
  onEnd: (next: 'selected' | 'unselected') => void;
  /** Per-client undo history (story 8). */
  undo: UndoController;
}

/**
 * Generalised text editor (story 9). A textarea diffed into a Y.Text.
 *
 * - On mount: value comes from the Y.Text, focus, caret at the end.
 * - On each input: clamp to maxChars, apply minimal diff to the Y.Text, call onInput.
 * - Escape → onEnd('selected'); pointerdown outside → onEnd('unselected').
 * - Enter inserts a new line (native textarea behaviour).
 * - Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y: undo/redo via the controller.
 */
export function TextEditor({ ytext, maxChars, fontPx, onInput, onEnd, undo }: TextEditorProps): React.ReactElement {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState<string>(() => ytext.toString());
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // Mount: start undo boundary, focus, caret at end.
  // Use requestAnimationFrame to ensure focus is set after the browser's
  // default pointerdown focus behaviour has completed (the click that
  // created the text object would otherwise steal focus from the textarea).
  useEffect(() => {
    undoRef.current.boundary();
    const raf = requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // External Y.Text changes (remote edits, in-editor undo) resync the textarea.
  useEffect(() => {
    const handler = () => {
      const ta = taRef.current;
      if (!ta) return;
      const docValue = ytext.toString();
      if (docValue !== ta.value) {
        ta.value = docValue;
        setValue(docValue);
        const len = docValue.length;
        ta.setSelectionRange(len, len);
      }
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // Pointerdown outside the editor ends editing as "unselected".
  // Guard: ignore the pointerdown that triggered the editor to mount
  // (e.g., the click that created the text object with the Text tool).
  const justMountedRef = useRef(true);
  useEffect(() => {
    // Clear the guard on the next tick (after the current pointerdown finishes).
    const timer = setTimeout(() => { justMountedRef.current = false; }, 0);
    const handler = (e: PointerEvent) => {
      if (justMountedRef.current) return;
      const ta = taRef.current;
      if (!ta) return;
      const target = e.target;
      if (target instanceof Node && ta.contains(target)) return;
      endEditingRef.current('unselected');
    };
    window.addEventListener('pointerdown', handler);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', handler);
    };
  }, []);

  const commit = (next: string): string => {
    const clamped = clampToLimit(next, maxChars);
    setValue(clamped);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    onInputRef.current();
    return clamped;
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const ta = e.target;
    if (composingRef.current) {
      setValue(ta.value);
      return;
    }
    const clamped = commit(ta.value);
    if (clamped.length !== ta.value.length) {
      const len = clamped.length;
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.setSelectionRange(len, len);
      });
    }
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    commit((e.target as HTMLTextAreaElement).value);
  };

  const endEditing = (next: 'selected' | 'unselected') => {
    undoRef.current.boundary();
    onEndRef.current(next);
  };
  const endEditingRef = useRef(endEditing);
  endEditingRef.current = endEditing;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) undoRef.current.redo();
      else undoRef.current.undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      undoRef.current.redo();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      endEditing('selected');
    }
    // Enter falls through to insert a newline.
  };

  const handleBlur = () => {
    const ta = taRef.current;
    if (ta) commit(ta.value);
  };

  return (
    <div
      data-testid="text-editor"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
      }}
    >
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        aria-label="Text"
        spellCheck={false}
        style={{
          width: '100%',
          height: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'inherit',
          fontSize: `${fontPx}px`,
          fontFamily: TEXT_FONT_FAMILY,
          lineHeight: 1.3,
          padding: 0,
          boxSizing: 'border-box',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
    </div>
  );
}
