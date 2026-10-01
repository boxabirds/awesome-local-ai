import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
} from '../../shared/board-model';
import {
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** Text box height available for the text, in world units. */
  boxPx?: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

const NOTE_PADDING_WORLD = 12;


/**
 * The textarea shown while a sticky note is being edited.
 *
 * Every `input` event is written through to the shared `Y.Text` immediately as
 * a minimal diff, so ending editing performs no extra write. Input arriving
 * during IME composition is deferred to `compositionend`. Escape ends editing
 * with the note still selected; a pointerdown outside the note ends it as
 * unselected (the parent note handles the outside listener).
 */
export function StickyTextEditor({
  ytext,
  fontPx,
  boxPx = STICKY_SIZE_WORLD,
  onEnd,
}: StickyTextEditorProps): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [length, setLength] = useState(() => ytext.toString().length);

  // Mount: seed the textarea from the document, focus it, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    setLength(el.value.length);
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [ytext]);

  const write = useCallback(
    (value: string) => {
      const el = ref.current;
      const kept = clampToLimit(value);
      if (kept !== value && el) {
        // Characters beyond the limit are dropped; the caret goes to the end
        // of the kept text.
        el.value = kept;
        el.setSelectionRange(kept.length, kept.length);
      }
      applyTextDiff(ytext, kept, LOCAL_ORIGIN);
      setLength(kept.length);
    },
    [ytext],
  );

  const onInput = useCallback(
    (event: React.FormEvent<HTMLTextAreaElement>) => {
      if (composingRef.current) {
        // Still update the counter, but the document write waits for
        // compositionend so intermediate IME states never reach Y.Text.
        setLength(event.currentTarget.value.length);
        return;
      }
      write(event.currentTarget.value);
    },
    [write],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onEnd('selected');
      }
      // Enter inserts a newline: the default behaviour of a textarea.
    },
    [onEnd],
  );

  // Flush any value left over from an interrupted composition on blur.
  const onBlur = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.value !== ytext.toString()) write(el.value);
  }, [write, ytext]);

  const showCounter = counterVisible(length);

  return (
    <div className="sticky-editor" data-testid="sticky-editor">
      <textarea
        ref={ref}
        className="sticky-textarea"
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
        spellCheck={false}
        style={{
          fontSize: `${fontPx}px`,
          padding: `${NOTE_PADDING_WORLD}px`,
          maxHeight: `${boxPx}px`,
        }}
        onInput={onInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          const el = ref.current;
          if (el) write(el.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onPointerDown={(event) => event.stopPropagation()}
      />
      {showCounter ? (
        <span className="sticky-counter" data-testid="sticky-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
    </div>
  );
}
