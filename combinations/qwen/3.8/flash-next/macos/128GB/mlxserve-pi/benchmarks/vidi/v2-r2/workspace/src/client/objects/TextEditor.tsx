// The caret the user types into. One editor for every object with text, because
// the rules that matter are the same for a sticky note and for a text object, and
// getting them wrong in one place would be wrong in both:
//
//   - the caret starts at the end of whatever the text already says
//   - Enter adds a line; only Escape leaves editing
//   - every keystroke is already in the Y.Text when the editor goes away, so
//     ending editing writes nothing
//   - a change from elsewhere lands in the field without moving the caret's end
//   - characters past the limit are dropped as they arrive, so a paste of 1,200
//     characters into a note leaves exactly the first 1,000
//   - Ctrl/Cmd+Z (⇧ to redo) is routed to the board's undo, not the browser's
//
// What differs per type is only how the box is arrived at, and that is a prop:
//   - a sticky note keeps its box and shrinks its font until the text fits `fit`
//   - a text object keeps its font - the size preset is the font size - and its
//     owner re-measures the box after every `onInput`, which is how the box grows
//     as the text grows
//
// A pointerdown outside the object finishes editing and deselects.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { flushSync } from 'react-dom';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit, applyTextDiff } from '../../shared/text-edit';
import type { EndEditNext } from '../board/useSelection';
import type { UndoController } from '../board/undo';
import { fitFontSize } from './StickyText';

/** Attribute the object root carries, to tell a click inside it from outside. */
export const OBJECT_ATTRIBUTE = 'data-note-id';

export interface TextEditorProps {
  ytext: Y.Text;
  /** Characters this text may hold; further characters are dropped. */
  maxChars: number;
  /** Font size to start with - and the only size, for a type that does not fit. */
  fontPx: number;
  /**
   * Width the text lays out in, world units, or 'auto' for a type whose own box
   * is set by CSS around it.
   */
  width: number | 'auto';
  /** Given, the editor shrinks the font until the text fits this height. */
  fit?: { height: number };
  /**
   * Called after every change this editor made to the document - and never after
   * a change that arrived from elsewhere. A text object's owner re-measures its
   * box here; a sticky note has nothing to re-measure and does nothing.
   */
  onInput(): void;
  onEnd(next: EndEditNext): void;
  /**
   * The board's undo controller. Opening and closing the editor are undo
   * boundaries, so a run of typing is one step and never merges with a drag or a
   * recolour next door. Null when the editor is rendered outside a board.
   */
  undo: UndoController | null;
  testId: string;
  ariaLabel: string;
  className: string;
  /** Above this many remaining characters the "940/1000" counter shows. */
  counterThreshold?: number;
  /** Attribute naming the element a click inside of keeps the edit going. */
  insideAttribute?: string;
  style?: CSSProperties;
}

/** True when the counter should show for a text of this length. */
export function textCounterVisible(
  length: number,
  maxChars: number,
  threshold: number | undefined,
): boolean {
  if (threshold === undefined || !Number.isFinite(length)) return false;
  return maxChars - length <= threshold;
}

export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  fit,
  onInput,
  onEnd,
  undo,
  testId,
  ariaLabel,
  className,
  counterThreshold,
  insideAttribute = OBJECT_ATTRIBUTE,
  style,
}: TextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const [size, setSize] = useState<{ fontPx: number; overflow: boolean }>({
    fontPx,
    overflow: false,
  });
  /** True while an input method (e.g. Japanese) is assembling a word. */
  const composingRef = useRef(false);
  const endedRef = useRef(false);

  const end = useCallback(
    (next: EndEditNext) => {
      if (endedRef.current) return;
      endedRef.current = true;
      onEnd(next);
    },
    [onEnd],
  );

  // Undo boundaries (story 8): opening the editor closes whatever step came before
  // it, and closing the editor closes the run of typing. The cleanup covers every
  // way editing ends - Escape, a click outside, the object vanishing.
  useEffect(() => {
    undo?.boundary();
    return () => undo?.boundary();
  }, [undo]);

  // A number rather than the caller's object, so a new { height } per render does
  // not read as a new reason to measure.
  const fitHeight = fit === undefined ? null : fit.height;
  /** The latest onInput, kept out of the callbacks' identities. */
  const inputRef = useRef(onInput);
  inputRef.current = onInput;

  /** Re-measure the text after it changed: only a fitting type measures. */
  const measure = useCallback(
    (): void => {
      const el = ref.current;
      if (el === null) return;
      if (fitHeight === null) return; // a preset-sized text never re-measures itself
      const next = fitFontSize(el, Math.max(0, fitHeight));
      setSize((previous) =>
        previous.fontPx === next.fontPx && previous.overflow === next.overflow
          ? previous
          : { fontPx: next.fontPx, overflow: next.overflow },
      );
    },
    [fitHeight],
  );

  // Editing starts with the caret at the end of whatever the text already says, so
  // continuing a thought does not need a click.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.focus();
    const length = el.value.length;
    el.setSelectionRange(length, length);
    measure();
  }, [measure]);

  // A pointerdown anywhere outside the object finishes editing and deselects. It
  // runs in the capture phase so it lands before the clicked thing takes the click
  // for itself: clicking another object selects that one, not nothing.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current;
      if (el === null) return;
      const object = el.closest(`[${insideAttribute}]`);
      const target = event.target as Node | null;
      if (object !== null && target !== null && object.contains(target)) return;
      end('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [end, insideAttribute]);

  // The value is written to the document on every input, so unmounting (an object
  // deleted from elsewhere, a reload) cannot lose a character.
  useEffect(
    () => () => {
      const el = ref.current;
      if (el === null || composingRef.current) return;
      applyTextDiff(ytext, clampToLimit(el.value, maxChars), LOCAL_ORIGIN);
    },
    [ytext, maxChars],
  );

  // A remote edit to this text must land in the textarea too, or the next local
  // keystroke's diff would delete it (story 3 merges concurrent typing). We skip
  // our own writes and any in-flight IME composition, and keep the caret the same
  // distance from the end so typing continues where the user left off. The box is
  // NOT re-measured here: the client that changed the text measured it (story 9).
  //
  // The render is flushed rather than left to React's own schedule, and that is
  // what makes two people typing into one text safe: the field has to be showing
  // the other person's characters before the next keystroke is diffed against the
  // document, or that keystroke's diff reads as "those characters are gone" and
  // deletes them. A keystroke can arrive a millisecond after the update lands,
  // which is sooner than a scheduled render happens to run.
  useEffect(() => {
    const onRemote = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN || composingRef.current) return;
      const next = clampToLimit(ytext.toString(), maxChars);
      const el = ref.current;
      // The caret keeps its distance from the END of the text: a character that
      // landed elsewhere leaves this caret alone, and one landed at it is typed
      // after rather than over.
      const afterCaret = el === null ? 0 : el.value.length - el.selectionEnd;
      const caret = Math.min(Math.max(0, next.length - afterCaret), next.length);
      flushSync(() => {
        setValue(next);
      });
      const node = ref.current;
      if (node !== null) node.setSelectionRange(caret, caret);
      measure();
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
  }, [ytext, maxChars, measure]);

  const applyValue = useCallback(
    (next: string): void => {
      const kept = clampToLimit(next, maxChars);
      setValue(kept);
      applyTextDiff(ytext, kept, LOCAL_ORIGIN);
      const el = ref.current;
      if (el !== null && kept !== next) {
        // the characters past the limit never make it in; put the caret back at
        // the end of the text that did
        el.value = kept;
        el.setSelectionRange(kept.length, kept.length);
      }
      measure();
      inputRef.current();
    },
    [maxChars, measure, ytext],
  );

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    // While an input method is composing, the browser is still assembling the
    // text; the compositionend handler writes it once it is final.
    if (composingRef.current) return;
    applyValue(event.target.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter belongs to the text: it adds a line. Only Escape leaves editing.
    if (event.key === 'Escape') {
      event.preventDefault();
      end('selected');
      return;
    }
    // Ctrl/Cmd+Z undoes (⇧ to redo, or Ctrl/Cmd+Y) the typing here, in place: the
    // keystroke is stopped from reaching the browser's own textarea undo, and the
    // board's window shortcut never sees it because this field is a typing target.
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        if (event.shiftKey) undo?.redo();
        else undo?.undo();
        // show the reversed text here, in place, without losing the caret's field
        setValue(ytext.toString());
        inputRef.current();
        return;
      }
      if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault();
        undo?.redo();
        setValue(ytext.toString());
        inputRef.current();
      }
    }
  };

  return (
    <>
      <textarea
        ref={ref}
        className={`${className}${size.overflow ? ' has-overflow' : ''}`}
        data-testid={testId}
        data-font-px={size.fontPx}
        data-overflow={size.overflow}
        style={
          {
            ...style,
            fontSize: `${size.fontPx}px`,
            ...(width === 'auto' ? null : { width: `${width}px` }),
          } as CSSProperties
        }
        value={value}
        aria-label={ariaLabel}
        spellCheck={false}
        onChange={onChange}
        onInput={(event) => {
          // jsdom and older engines deliver text through input as well; React's
          // onChange already covers browsers that fire both.
          if (composingRef.current) return;
          if (event.currentTarget.value !== value) applyValue(event.currentTarget.value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          applyValue(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
      />
      {textCounterVisible(value.length, maxChars, counterThreshold) ? (
        <span className="sticky-counter" data-testid="sticky-counter" aria-live="polite">
          {value.length}
          /{maxChars}
        </span>
      ) : null}
      {size.overflow ? (
        <span className="sticky-fade" data-testid="sticky-fade" aria-hidden="true" />
      ) : null}
    </>
  );
}
