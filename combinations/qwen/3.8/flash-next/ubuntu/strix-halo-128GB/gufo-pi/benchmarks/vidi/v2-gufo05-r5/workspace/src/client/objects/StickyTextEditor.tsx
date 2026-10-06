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

/**
 * The text editor inside a sticky note.
 *
 * Mounted for exactly one note (the one being edited) and unmounted when editing ends.
 * Every keystroke is written into the shared `Y.Text` immediately, as the minimal
 * insert/delete, so ending editing has nothing left to write and text typed at the same
 * time by someone else (story 3) is never overwritten.
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
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
  STICKY_TEXT_BOX_WORLD,
} from './StickyText';

export interface StickyTextEditorProps {
  /** The note's shared text. When the note is deleted the text is detached and writes stop. */
  ytext: Y.Text;
  /** Font size to start with, in world units (re-fitted as the text changes). */
  fontPx: number;
  /** Called when editing ends: back to selected (Escape) or deselected (click outside). */
  onEnd(next: EndEditNext): void;
  /**
   * Story 8: this person's history. The editor is a step of its own - typing starts a step when it
   * opens and closes one when it shuts - and Ctrl/Cmd+Z inside the field belongs to that history
   * rather than to the browser's textarea undo.
   */
  undo?: UndoController | null;
}

export function StickyTextEditor({ ytext, fontPx, onEnd, undo }: StickyTextEditorProps): JSX.Element {
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

  // ---- story 8: editing this note is a step of its own ----
  useEffect(() => {
    undoRef.current?.boundary();
    return () => {
      // whatever was typed in this session with the field open is one step, whether it was two
      // characters or two hundred
      undoRef.current?.boundary();
    };
  }, []);

  // ---- start editing: focus the note's text and put the caret at the end ----
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // ---- a pointerdown outside the note ends editing and deselects it ----
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const note = el.closest('[data-sticky-note]');
      const target = event.target as Node | null;
      if (note && target && note.contains(target)) return;
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

  // ---- re-fit the font once the new text is on screen ----
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = fitFontSize(el, STICKY_TEXT_BOX_WORLD);
    setFontPx((previous) => (previous === fit.fontPx ? previous : fit.fontPx));
  }, [value]);

  const writeToDoc = useCallback(
    (next: string) => {
      // The note may have been deleted while editing: its Y.Text is then detached.
      if (!ytext.doc) return;
      applyTextDiff(ytext, next, LOCAL_ORIGIN);
    },
    [ytext],
  );

  // ---- text somebody else typed, taken in while this note is being edited ----
  // Every keystroke is written to the shared text as it happens, so this editor's value is
  // the shared text and nothing more: what arrives from elsewhere can simply be taken in,
  // which is what keeps both people's characters instead of overwriting the other's. The
  // caret moves along with the incoming edit so typing at either end does not yank it about.
  useEffect(() => {
    const onRemoteText = (event: Y.YTextEvent, origin: unknown) => {
      // `LOCAL_ORIGIN` means "this screen wrote it", and it is already in the value; a
      // composition in progress is left to finish on its own.
      if (origin === LOCAL_ORIGIN || composingRef.current) return;
      if (!ytext.doc) return; // the note was deleted mid-edit; the editor unmounts anyway
      const el = ref.current;
      if (el) caretRef.current = shiftCaret(el.selectionStart, event.delta);
      setValue(clampToLimit(ytext.toString()));
    };
    ytext.observe(onRemoteText);
    return () => ytext.unobserve(onRemoteText);
  }, [ytext]);

  const handleChange = (event: { currentTarget: HTMLTextAreaElement }) => {
    const raw = event.currentTarget.value;
    const clamped = clampToLimit(raw);
    if (clamped !== raw) caretRef.current = clamped.length; // characters beyond the limit are dropped
    setValue(clamped);
    if (!composingRef.current) writeToDoc(clamped);
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    const clamped = clampToLimit(event.currentTarget.value);
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
        className="sticky-note__input"
        data-testid="sticky-note-input"
        aria-label="Sticky note text"
        value={value}
        spellCheck={false}
        style={{ fontSize: `${fontPxState}px` }}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {counterVisible(value.length) ? (
        <div className="sticky-note__counter" data-testid="note-counter">
          {`${value.length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      ) : null}
    </>
  );
}
