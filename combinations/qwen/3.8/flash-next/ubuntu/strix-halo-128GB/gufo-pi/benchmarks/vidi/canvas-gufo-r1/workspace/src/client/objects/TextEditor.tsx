import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undoController?: UndoController | null;
  testId?: string;
}

/**
 * Generalised textarea editor for text objects.
 * - On mount: sets value from Y.Text, focuses, caret at end.
 * - On input: clamps to maxChars, applies minimal diff to Y.Text.
 * - On remote ytext changes: updates textarea, preserves caret at end.
 * - Escape: ends editing with 'selected'.
 * - Click outside / blur: ends editing with 'unselected'.
 * - Enter inserts newline (not intercepted).
 * - Ctrl/Cmd+Z: undo within the controller.
 * - Ctrl/Cmd+Shift+Z: redo within the controller.
 */
export function TextEditor(props: TextEditorProps) {
  const { ytext, maxChars, fontPx, width, onInput, onEnd, undoController, testId } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // On mount: call boundary (start of edit), set value, focus, caret at end
  useEffect(() => {
    undoController?.boundary();
    const ta = textareaRef.current;
    if (!ta) return;
    ta.value = ytext.toString();
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }, [ytext, undoController]);

  // Handle remote changes: update textarea when ytext changes from remote
  useEffect(() => {
    const handler = (event: Y.YTextEvent, transaction: { local: boolean }) => {
      if (transaction.local) return;
      const ta = textareaRef.current;
      if (!ta) return;
      const newText = event.target.toString();
      ta.value = newText;
      // Place caret at end
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // Handle click outside to end editing
  useEffect(() => {
    let active = false;
    Promise.resolve().then(() => { active = true; });
    const handlePointerDown = (e: PointerEvent | MouseEvent) => {
      if (!active) return;
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onEnd('unselected');
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      active = false;
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onEnd]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const raw = ta.value;
    const clamped = clampToLimit(raw, maxChars);
    if (clamped !== raw) {
      ta.value = clamped;
      const len = clamped.length;
      ta.setSelectionRange(len, len);
    }
    applyTextDiff(ytext, clamped, 'local');
    onInput();
  }, [ytext, maxChars, onInput]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    handleInput();
  }, [handleInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        undoController?.boundary();
        onEnd('selected');
        return;
      }

      const isMod = e.ctrlKey || e.metaKey;

      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (undoController) undoController.undo();
        return;
      }

      if (isMod && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (undoController) undoController.redo();
        return;
      }

      if (e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        e.stopPropagation();
        if (undoController) undoController.redo();
        return;
      }

      // Enter inserts newline in textarea (default behavior, not intercepted)
    },
    [onEnd, undoController],
  );

  const widthStyle = width === 'auto' ? undefined : `${width}px`;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <textarea
        ref={textareaRef}
        className="text-editor-textarea"
        style={{
          fontSize: `${fontPx}px`,
          width: widthStyle ?? '100%',
          minWidth: widthStyle ?? undefined,
          height: '100%',
          border: 'none',
          background: 'transparent',
          resize: 'none',
          outline: 'none',
          padding: 0,
          margin: 0,
          fontFamily: 'inherit',
          lineHeight: 1.3,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
        onInput={handleInput}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        data-testid={testId ?? 'text-editor-textarea'}
      />
    </div>
  );
}
