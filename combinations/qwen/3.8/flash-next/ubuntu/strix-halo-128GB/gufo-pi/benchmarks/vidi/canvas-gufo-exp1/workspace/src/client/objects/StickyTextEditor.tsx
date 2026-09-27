/**
 * The textarea shown while a sticky note is being edited.
 *
 * Every `input` event is written to the Y.Text immediately through
 * `applyTextDiff`, so ending editing performs no additional write — text typed
 * so far is already in the document. Escape ends editing keeping the selection;
 * a pointerdown outside the note ends editing and clears it (the container
 * listens on window and calls `onEnd('unselected')`).
 */
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';
import { LOCAL_ORIGIN } from '../../shared/board-model';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState<string>(() => ytext.toString());
  const composingRef = useRef(false);

  // Mount: caret goes to the end of the existing text (sticky.edit_start).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  const commit = (raw: string): void => {
    const next = clampToLimit(raw);
    const el = textareaRef.current;
    if (next !== raw && el) {
      // Characters beyond the limit are dropped; the caret ends at the kept text.
      el.value = next;
      el.setSelectionRange(next.length, next.length);
    }
    setValue(next);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
  };

  const onInput = (): void => {
    if (composingRef.current) return; // handled on compositionend
    const el = textareaRef.current;
    if (!el) return;
    commit(el.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEnd('selected');
    }
    // Enter is deliberately not intercepted: the textarea inserts a newline.
  };

  return (
    <div className="sticky-editor" onPointerDown={(event) => event.stopPropagation()}>
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        value={value}
        style={{ fontSize: `${fontPx}px` }}
        aria-label="Sticky note text"
        spellCheck={false}
        onChange={onInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          const el = textareaRef.current;
          if (el) commit(el.value);
        }}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          // Clamp immediately so the counter and the model never see > limit.
          const el = textareaRef.current;
          if (!el) return;
          const pasted = event.clipboardData.getData('text');
          const remaining = STICKY_TEXT_MAX_CHARS - value.length;
          if (pasted.length > remaining) {
            event.preventDefault();
            commit(value + pasted.slice(0, Math.max(0, remaining)));
          }
        }}
      />
      {counterVisible(value.length) && (
        <span className="sticky-counter" data-testid="sticky-counter">
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
