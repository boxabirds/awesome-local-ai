import { useRef, useCallback, useEffect } from 'react';
import * as Y from 'yjs';
import { TEXT_MAX_CHARS } from '@shared/config';
import { clampToLimit, applyTextDiff } from '@shared/text-edit';

interface TextEditorProps {
  ytext: Y.Text;
  maxChars?: number;
  fontPx: number;
  width?: number | 'auto';
  onInput(): void;
  /** Called when editing ends. 'selected' keeps the object selected, 'unselected' clears selection. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Called when entering edit mode (sets undo boundary). */
  onUndoBoundary(): void;
  onUndo(): boolean;
  onRedo(): boolean;
}

export function TextEditor({
  ytext,
  maxChars = TEXT_MAX_CHARS,
  fontPx,
  width,
  onInput,
  onEnd,
  onUndoBoundary,
  onUndo,
  onRedo,
}: TextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // On mount: set value from Y.Text, focus, caret at end
  useEffect(() => {
    if (!textareaRef.current) return;
    const text = ytext.toString();
    textareaRef.current.value = text;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(text.length, text.length);
    onUndoBoundary();
  }, [ytext, onUndoBoundary]);

  const handleInput = useCallback(() => {
    if (composingRef.current || !textareaRef.current) return;
    const nextValue = textareaRef.current.value;
    const clamped = clampToLimit(nextValue, maxChars);
    const clipped = clamped !== nextValue;

    // Restore value if we had to truncate
    if (clipped && textareaRef.current) {
      textareaRef.current.value = clamped;
      const pos = clamped.length;
      textareaRef.current.setSelectionRange(pos, pos);
    }

    applyTextDiff(ytext, clipped ? clamped : nextValue, {});
    onInput?.();
  }, [ytext, maxChars, onInput]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    handleInput();
  }, [handleInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const isUndo =
        isCmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'z';
      const isRedo =
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
        (e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'y');

      if (isUndo) {
        e.preventDefault();
        e.stopPropagation();
        onUndo();
        return;
      }
      if (isRedo) {
        e.preventDefault();
        e.stopPropagation();
        onRedo();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEnd('selected');
      }
    },
    [onEnd, onUndo, onRedo],
  );

  return (
    <textarea
      ref={textareaRef}
      onBlur={() => {
        onEnd('selected');
      }}
      style={{
        width: width && typeof width === 'number' ? `${width}px` : '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: `${fontPx}px`,
        lineHeight: '1.3',
        padding: 0,
        textAlign: 'left',
        color: '#222',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        cursor: 'text',
        userSelect: 'text',
        boxSizing: 'border-box',
      }}
      inputMode="text"
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    />
  );
}

/** 
 * StickyTextEditor component - thin wrapper using TextEditor internally.
 * Used by StickyNote when editing.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd, onUndoBoundary, onUndo, onRedo }: any) {
  // Render nothing here; StickyNote handles its own editor rendering inline.
  // The TextEditor above is generalised for text objects with variable sizes.
  return null;
}
