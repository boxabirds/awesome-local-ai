/**
 * TextEditor: a generalised textarea editor for text objects.
 * Derived from StickyTextEditor (story 2) with configurable limit and font.
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undo: UndoController;
}

/**
 * The textarea shown while a text object is being edited.
 *
 * Every `input` event is written through to the shared `Y.Text` immediately as
 * a minimal diff, so ending editing performs no extra write. Input arriving
 * during IME composition is deferred to `compositionend`. Escape ends editing
 * with the text still selected; a pointerdown outside ends it as unselected.
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undo,
}: TextEditorProps): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [, setLength] = useState(0);

  // Mount: seed the textarea from the document, focus it, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    setLength(el.value.length);
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    undo.boundary();
  }, [ytext]);

  const write = useCallback(
    (value: string) => {
      const el = ref.current;
      const kept = clampToLimit(value, maxChars);
      if (kept !== value && el) {
        el.value = kept;
        el.setSelectionRange(kept.length, kept.length);
      }
      applyTextDiff(ytext, kept, LOCAL_ORIGIN);
      setLength(kept.length);
      onInput();
    },
    [ytext, maxChars, onInput],
  );

  const onInputHandler = useCallback(
    (event: React.FormEvent<HTMLTextAreaElement>) => {
      if (composingRef.current) {
        setLength(event.currentTarget.value.length);
        return;
      }
      write(event.currentTarget.value);
    },
    [write],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      // Undo inside the editor: Ctrl/Cmd+Z
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'z') {
        event.preventDefault();
        event.stopPropagation();
        undo.undo();
        const el = ref.current;
        if (el) {
          const newText = ytext.toString();
          el.value = newText;
          setLength(newText.length);
        }
        return;
      }
      // Redo inside the editor: Ctrl/Cmd+Shift+Z or Ctrl+Y
      if (
        ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'z' || event.key === 'Z')) ||
        (event.ctrlKey && !event.metaKey && event.key === 'y')
      ) {
        event.preventDefault();
        event.stopPropagation();
        undo.redo();
        const el = ref.current;
        if (el) {
          const newText = ytext.toString();
          el.value = newText;
          setLength(newText.length);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        undo.boundary();
        onEnd('selected');
      }
      // Enter inserts a newline: the default behaviour of a textarea.
    },
    [onEnd, undo, ytext],
  );

  // Flush any value left over from an interrupted composition on blur.
  const onBlur = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.value !== ytext.toString()) write(el.value);
    undo.boundary();
  }, [write, ytext, undo]);

  return (
    <div className="text-editor" data-testid="text-editor">
      <textarea
        ref={ref}
        className="text-textarea"
        data-testid="text-textarea"
        aria-label="Text content"
        spellCheck={false}
        style={{
          fontSize: `${fontPx}px`,
          fontFamily: 'Inter, system-ui, sans-serif',
          lineHeight: 1.3,
          width: width === 'auto' ? 'auto' : `${width}px`,
          minWidth: width === 'auto' ? 40 : `${width}px`,
          minHeight: `${fontPx * 1.3}px`,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          padding: 0,
          margin: 0,
          resize: 'none',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
        onInput={onInputHandler}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => {
          composingRef.current = false;
          const el = ref.current;
          if (el) write(el.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onPointerDown={(event) => event.stopPropagation()}
      />
    </div>
  );
}
