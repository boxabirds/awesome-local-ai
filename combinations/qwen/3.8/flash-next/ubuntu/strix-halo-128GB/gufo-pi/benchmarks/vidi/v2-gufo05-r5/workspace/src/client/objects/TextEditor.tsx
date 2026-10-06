/**
 * The shared inline text editor (story 2 for sticky notes, story 9 for text objects).
 *
 * Mounted for exactly one object - the one being edited - and unmounted when editing ends.
 * Every keystroke is written into the shared `Y.Text` immediately, as the minimal
 * insert/delete, so ending editing has nothing left to write and text typed at the same time
 * by somebody else (story 3) is never overwritten.
 *
 * What differs between object types is passed in: the character limit, the font size, whether
 * the font shrinks to fit (`fitTo`, a note), whether a remaining-characters counter is shown,
 * and the class names the type's own stylesheet expects.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CompositionEvent,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
} from 'react';
import * as Y from 'yjs';
import type { EndEditNext } from '../board/useSelection';
import type { UndoController } from '../board/undo';
import { LOCAL_ORIGIN, transactionOrigin } from '../../shared/y-origin';
import { applyTextDiff, clampToLimit } from '../../shared/text-edit';
import { counterVisible, fitFontSize } from './StickyText';

/**
 * Where the caret goes when somebody else's edit (a `Y.Text` delta) is taken in: characters
 * inserted before it push it along, deleted ones pull it back, and a caret inside deleted
 * text lands where the deletion started.
 */
function shiftCaret(
  caret: number,
  delta: readonly {
    readonly retain?: number;
    readonly insert?: unknown;
    readonly delete?: number;
  }[],
): number {
  let position = caret;
  let index = 0; // how far into the *previous* text we have walked
  for (const part of delta) {
    if (typeof part.retain === 'number') {
      index += part.retain;
    } else if (typeof part.insert === 'string') {
      if (index < position) position += part.insert.length;
    } else if (typeof part.delete === 'number') {
      const end = index + part.delete;
      if (position > index) position = position >= end ? position - part.delete : index;
      index = end;
    }
  }
  return position;
}

export interface TextEditorProps {
  /** The object's shared text. When the object is deleted the text is detached and writes stop. */
  ytext: Y.Text;
  /** Characters kept, whatever is typed or pasted in. */
  maxChars: number;
  /** Font size to start with, in world units. */
  fontPx: number;
  /** Called when editing ends: back to selected (Escape) or deselected (click outside). */
  onEnd(next: EndEditNext): void;
  /**
   * Story 8: this person's history. The editor is a step of its own - typing starts a step when it
   * opens and closes one when it shuts - and Ctrl/Cmd+Z inside the field belongs to that history
   * rather than to the browser's textarea undo.
   */
  undo?: UndoController | null;
  /**
   * When set, the largest font at which the content still fits this width (world units) is used -
   * what a sticky note does. A text object leaves the font alone: its size preset *is* the choice.
   */
  fitTo?: number;
  /**
   * When set, a counter shows the characters left once they are down to `threshold`.
   */
  counter?: { threshold: number };
  className: string;
  testId: string;
  ariaLabel: string;
  counterClassName?: string;
  counterTestId?: string;
}

export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  onEnd,
  undo,
  fitTo,
  counter,
  className,
  testId,
  ariaLabel,
  counterClassName,
  counterTestId,
}: TextEditorProps): JSX.Element {
  const [value, setValue] = useState(() => ytext.toString());
  const [fontPxState, setFontPx] = useState(fontPx);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // IME composition (e.g. Japanese input): the diff runs on compositionend instead of
  // on every keystroke, so half-typed candidates never duplicate characters.
  const composingRef = useRef(false);
  const caretRef = useRef<number | null>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // ---- story 8: editing this object is a step of its own ----
  useEffect(() => {
    undoRef.current?.boundary();
    return () => {
      // whatever was typed in this session with the field open is one step, whether it was two
      // characters or two hundred
      undoRef.current?.boundary();
    };
  }, []);

  // ---- start editing: focus the object's text and put the caret at the end ----
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // ---- a pointerdown outside the object ends editing and deselects it ----
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const object = el.closest('[data-board-object]');
      const target = event.target as Node | null;
      if (object && target && object.contains(target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  // ---- after a clamped keystroke, put the caret back at the end of the kept text ----
  useEffect(() => {
    if (caretRef.current === null) return;
    const position = caretRef.current;
    caretRef.current = null;
    ref.current?.setSelectionRange(position, position);
  }, [value]);

  // ---- re-fit the font once the new text is on screen (notes only) ----
  useEffect(() => {
    if (fitTo === undefined) return;
    const el = ref.current;
    if (!el) return;
    const fit = fitFontSize(el, fitTo);
    setFontPx((previous) => (previous === fit.fontPx ? previous : fit.fontPx));
  }, [value, fitTo]);

  const writeToDoc = useCallback(
    (next: string) => {
      // The object may have been deleted while editing: its Y.Text is then detached.
      if (!ytext.doc) return;
      applyTextDiff(ytext, next, LOCAL_ORIGIN);
    },
    [ytext],
  );

  // ---- text somebody else typed, taken in while this object is being edited ----
  // Every keystroke is written to the shared text as it happens, so this editor's value is
  // the shared text and nothing more: what arrives from elsewhere can simply be taken in,
  // which is what keeps both people's characters instead of overwriting the other's. The
  // caret moves along with the incoming edit so typing at either end does not yank it about.
  useEffect(() => {
    const onRemoteText = (event: Y.YTextEvent, transaction: unknown) => {
      // `LOCAL_ORIGIN` means "this screen wrote it", and it is already in the value; a
      // composition in progress is left to finish on its own.
      if (transactionOrigin(event, transaction) === LOCAL_ORIGIN || composingRef.current) return;
      if (!ytext.doc) return; // the object was deleted mid-edit; the editor unmounts anyway
      const el = ref.current;
      if (el) caretRef.current = shiftCaret(el.selectionStart, event.delta);
      setValue(clampToLimit(ytext.toString(), maxChars));
    };
    ytext.observe(onRemoteText);
    return () => ytext.unobserve(onRemoteText);
  }, [ytext, maxChars]);

  const handleChange = (event: { currentTarget: HTMLTextAreaElement }) => {
    const raw = event.currentTarget.value;
    const clamped = clampToLimit(raw, maxChars);
    if (clamped !== raw) caretRef.current = clamped.length; // characters beyond the limit are dropped
    setValue(clamped);
    if (!composingRef.current) writeToDoc(clamped);
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    const clamped = clampToLimit(event.currentTarget.value, maxChars);
    setValue(clamped);
    writeToDoc(clamped);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Story 8: Ctrl/Cmd+Z inside the field is this person's history, not the textarea's. Without
    // taking the key over, the browser would undo into the shared text on its own terms - mixing
    // in the other person's characters, and putting back something the board has already lost.
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) undoRef.current?.redo();
      else undoRef.current?.undo();
      // The shared text changed underneath the field; the observer below takes it in (and moves
      // the caret), so focus and editing stay where they are.
      return;
    }
    if (event.key !== 'Escape') return; // Enter inserts a new line, Delete edits text
    event.preventDefault();
    event.stopPropagation();
    onEndRef.current('selected');
  };

  // Ending editing performs no additional write; this only catches a value that never
  // reached an input event (defensive, e.g. a browser autofill).
  const handleBlur = (event: FocusEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return;
    writeToDoc(event.currentTarget.value);
  };

  return (
    <>
      <textarea
        ref={ref}
        className={className}
        data-testid={testId}
        aria-label={ariaLabel}
        value={value}
        spellCheck={false}
        style={{ fontSize: `${fontPxState}px` }}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {counter && counterVisible(value.length, maxChars, counter.threshold) ? (
        <div className={counterClassName} data-testid={counterTestId}>
          {`${value.length}/${maxChars}`}
        </div>
      ) : null}
    </>
  );
}
