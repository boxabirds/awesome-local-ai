import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDelta, clampToLimit, counterVisible } from './StickyText';
import type { UndoController } from '../board/undo';

/**
 * The textarea that edits one `Y.Text` (anchor `text.object`, and story 2's
 * `sticky.text`).
 *
 * Story 9 generalised what story 2 wrote for sticky notes, because a text object
 * and a sticky note store their words the same way - one `Y.Text`, written with
 * the minimal change - and the two must not drift apart. What differs is a number,
 * not a rule: the character limit, the font size, how wide the field is, and what
 * the caller does after a change.
 *
 * Every input event writes the change to `Y.Text` immediately, so finishing
 * editing performs no additional write and nothing typed is lost. What is written
 * is the difference between the text the field was holding and what the person
 * changed it to - never the whole value - because someone else may be typing in the
 * same object at the same time (`text.concurrent`). After each write the field is
 * brought back into line with the document, so this editor always shows the board's
 * text, including other people's characters.
 *
 * The field is deliberately **not** a controlled input. React re-asserts a controlled
 * field after an input event, writing back the value from the render that is about to
 * be replaced; a keystroke that arrives before that render lands is applied to the
 * text React put back rather than to the text the person had typed, which moves a
 * character inside a word. Fast typing and paste do exactly that, and TC-26 is what
 * found it. The field owns its value, and `mirror` is the only thing that writes it.
 */
interface TextEditorProps {
  ytext: Y.Text;
  /** Characters this type allows (`text.limit`, `sticky.limit`). */
  maxChars: number;
  fontPx: number;
  /** The width of the field in board units, or `auto` to let CSS decide. */
  width: number | 'auto';
  /**
   * Called after every change **this editor** made - the caller's cue to measure
   * what it just wrote (`text.height`). Never called for a remote change.
   */
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  /** The board's undo controller (`undo.steps`); `null` when this board has none. */
  undo: UndoController | null;

  /** Show the character counter once this many characters are left. */
  counterLimit?: number;
  counterThreshold?: number;
  /** Painted over the object's own text so only one copy is visible. */
  background?: string;
  paddingPx?: number;
  className?: string;
  wrapClassName?: string;
  testId?: string;
  wrapTestId?: string;
  counterTestId?: string;
  ariaLabel: string;
}

export function TextEditor(props: TextEditorProps) {
  const {
    ytext,
    maxChars,
    fontPx,
    width,
    onInput,
    onEnd,
    undo,
    counterLimit,
    counterThreshold,
    background,
    paddingPx,
    className = 'text-editor',
    wrapClassName = 'text-editor__wrap',
    testId = 'text-editor',
    wrapTestId,
    counterTestId,
    ariaLabel,
  } = props;

  /**
   * The text the field was last showing.
   *
   * This is the base for the next difference, so it is the text this editor knows
   * the person was looking at - nothing older, and nothing that ignores what they
   * typed.
   */
  const textRef = useRef(ytext.toString());
  /** Only the counter needs a render; the field never does. */
  const [shownLength, setShownLength] = useState(() => textRef.current.length);

  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);

  /**
   * Bring the field into line with the board's text.
   *
   * Writing a textarea's value is not free: it moves the caret to the end of what
   * it is given. So a field that already holds the text is left alone - which is
   * every ordinary keystroke - and only a real difference (a character dropped for
   * the limit, a colleague's characters arriving) reaches the field. The caret stays
   * where the person had it, unless they were typing at the end.
   */
  const mirror = (next: string): void => {
    textRef.current = next;
    setShownLength(next.length);
    const el = ref.current;
    if (!el || el.value === next) {
      return;
    }
    const wasAtEnd = (el.selectionStart ?? 0) >= el.value.length;
    el.value = next;
    const position = wasAtEnd ? next.length : Math.min(el.selectionStart ?? 0, next.length);
    try {
      el.setSelectionRange(position, position);
    } catch {
      // jsdom: setSelectionRange exists, but never mind if a browser refuses.
    }
  };

  /**
   * An edit session is its own undo step (`undo.boundaries`).
   *
   * Opening the editor closes whatever step was open, so typing does not join a
   * move or a delete; closing it closes the typing step, so the next action is
   * separate. Inside the session, the capture window is what groups the typing - a
   * burst is one step, a burst with a pause in it is two.
   */
  useEffect(() => {
    undo?.boundary();
    return () => {
      undo?.boundary();
    };
  }, [undo]);

  // Caret at the end of the text when editing starts (`text.object`).
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.focus();
    if (el.value !== textRef.current) {
      el.value = textRef.current;
    }
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      // jsdom: setSelectionRange exists, but never mind if a browser refuses.
    }
  }, []);

  // Text changed somewhere else (story 3): show it, unless it is our own write.
  useEffect(() => {
    const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) {
        return;
      }
      const remote = ytext.toString();
      if (remote !== textRef.current) {
        mirror(remote);
      }
    };
    ytext.observe(observer);
    return () => ytext.unobserve(observer);
  }, [ytext]);

  const commit = (next: string) => {
    const kept = clampToLimit(next, maxChars);
    // The base for the difference is the text this field was holding when the person
    // edited it - never the whole value, and never a stale snapshot, because a burst
    // of keystrokes arrives as one change and overlapping differences would be
    // written at the wrong offset. Someone else may be typing in the same object at
    // the same time, and what they typed is already in the document (`text.concurrent`).
    applyTextDelta(ytext, textRef.current, kept, LOCAL_ORIGIN);
    // The document is the board's truth: it can hold other people's typing too, and
    // characters the limit dropped are dropped here rather than left in the field.
    mirror(ytext.toString());
    // Only a change this editor made gets here, which is what makes the box write
    // belong to this client (`text.height`, TC-12).
    onInput();
  };

  const handleInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) {
      return; // IME: wait for compositionend (not automated by tests)
    }
    commit(event.currentTarget.value);
  };

  const handleCompositionEnd = (event: React.CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    commit(event.currentTarget.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      commit(event.currentTarget.value);
      ref.current?.blur();
      onEnd('selected');
      return;
    }

    // The editor owns its keys, and the board's own handler ignores a key pressed
    // in a field. Ctrl/Cmd+Z undoes this person's last step - which may well be a
    // move made before this object was opened, because the history is the board's,
    // not this textarea's - and the browser's own undo, which knows nothing about
    // the document, is not allowed.
    const zKey =
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      (event.key === 'z' || event.key === 'Z' || event.key === 'y' || event.key === 'Y');
    if (zKey) {
      event.preventDefault();
      event.stopPropagation();
      // Whatever is in the textarea is already in the document (every input event
      // writes); committing again costs nothing and keeps the two in step.
      commit(event.currentTarget.value);
      if (event.key === 'y' || event.key === 'Y' || event.shiftKey) {
        undo?.redo();
      } else {
        undo?.undo();
      }
    }
    // Enter inside the textarea is a new line (`text.layout`); Delete and Backspace
    // edit characters.
  };

  const handleBlur = () => {
    const el = ref.current;
    if (el && !composingRef.current) {
      // Defensive flush: anything still unapplied from this editor only.
      applyTextDelta(ytext, textRef.current, clampToLimit(el.value, maxChars), LOCAL_ORIGIN);
      mirror(ytext.toString());
    }
  };

  const showCounter =
    counterLimit !== undefined &&
    counterThreshold !== undefined &&
    counterVisible(shownLength, counterLimit, counterThreshold);

  return (
    <div className={wrapClassName} data-testid={wrapTestId}>
      <textarea
        ref={ref}
        className={className}
        data-testid={testId}
        defaultValue={textRef.current}
        aria-label={ariaLabel}
        spellCheck={false}
        style={{
          fontSize: `${fontPx}px`,
          padding: paddingPx === undefined ? undefined : `${paddingPx}px`,
          width: typeof width === 'number' ? `${width}px` : undefined,
          background: background ?? 'transparent',
        }}
        onChange={handleInput}
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPointerDown={(event) => event.stopPropagation()}
      />
      {showCounter ? (
        <output
          className="text-editor__counter"
          data-testid={counterTestId}
          aria-label={`${shownLength} of ${maxChars} characters`}
        >
          {`${shownLength}/${maxChars}`}
        </output>
      ) : null}
    </div>
  );
}
