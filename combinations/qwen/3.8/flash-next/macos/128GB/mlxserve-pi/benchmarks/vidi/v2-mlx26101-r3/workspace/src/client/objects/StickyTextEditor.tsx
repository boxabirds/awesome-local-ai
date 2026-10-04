import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  CompositionEvent,
  FormEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import * as Y from 'yjs';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_PADDING_WORLD,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import type { UndoController } from '../board/undo';
import {
  applyAddedText,
  applyLocalEdit,
  clampToLimit,
  counterVisible,
  fitFontSize,
  mapCaret,
  type TextDeltaOp,
} from './StickyText';

/** Where the note ends up when editing stops. */
export type EditEnd = 'selected' | 'unselected';

export interface StickyTextEditorProps {
  /** The note's text: the value that survives, written to on every input event. */
  ytext: Y.Text;
  /** Font size the note fitted before editing started; re-fitted as the text grows. */
  fontPx: number;
  /** Escape (stay selected) or a click outside (deselect). */
  onEnd(next: EditEnd): void;
  /**
   * This person's undo history. A spell of typing is one step rather than one per letter, and
   * the boundary of that step is known here and nowhere else - the editor knows when the note was
   * opened and when it was closed, and the history does not. While this textarea has the keyboard,
   * Ctrl/Cmd+Z is this note's typing going back, not the browser's own undo of the textarea.
   * Left out, the editor neither opens a step nor answers the key.
   */
  undo?: UndoController;
}

/** Height available for text: the note minus its padding (jsdom has no layout at all). */
function textBox(el: HTMLTextAreaElement): number {
  return el.clientHeight > 0 ? el.clientHeight : STICKY_SIZE_WORLD - STICKY_PADDING_WORLD * 2;
}

function clampFont(fontPx: number): number {
  if (!Number.isFinite(fontPx)) {
    return STICKY_FONT_MAX_PX;
  }
  return Math.min(STICKY_FONT_MAX_PX, Math.max(STICKY_FONT_MIN_PX, Math.round(fontPx)));
}

function setCaretToEnd(el: HTMLTextAreaElement): void {
  const end = el.value.length;
  try {
    el.setSelectionRange(end, end);
  } catch {
    // A textarea that cannot take a selection still shows the text.
  }
}

/** The note element this editor is inside of, for "outside the note" hit tests. */
function noteElementOf(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>('[data-sticky-note]');
}

/**
 * The textarea that appears inside a note while it is being edited.
 *
 * Editing rules: the caret starts at the end of the existing text, every keystroke is
 * written to the note's `Y.Text` immediately (so stopping needs no save), text longer
 * than the product limit is cut off with the caret put back at the end of what was kept,
 * the font shrinks to fit as the text grows and a counter appears near the limit.
 * Escape keeps the note selected, a pointer press outside the note deselects it, and
 * Enter inserts a newline rather than closing the editor.
 *
 * And, because two people can be in one note at once: a change that arrives from anywhere
 * else is shown as it arrives, and the caret is put where it belongs afterwards. Nothing is
 * ever written back over somebody else's text - a keystroke is written as the difference it
 * made, never as the whole value of the textarea.
 */
export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  undo,
}: StickyTextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState<string>(() => ytext.toString());
  const [font, setFont] = useState<number>(() => clampFont(fontPx));
  const [overflow, setOverflow] = useState(false);
  const composingRef = useRef(false);
  const mountedRef = useRef(false);
  const onEndRef = useRef(onEnd);

  // The text this editor last saw in the document, whether from its own typing or from
  // somebody else's. Keystrokes are written as the difference from it, which is what keeps
  // somebody else's letters in the note: see `applyLocalEdit`.
  const baselineRef = useRef<string>(ytext.toString());
  // A caret to put back once React has written a new value into the textarea - React resets it.
  const caretRef = useRef<number | null>(null);
  // A change that arrived in the middle of Japanese input: the text it went to, and the text
  // it went from.
  const pendingRef = useRef<{ from: string; to: string } | null>(null);

  useEffect(() => {
    onEndRef.current = onEnd;
  });

  // Opening the note and closing it are the two ends of one undo step. Everything typed between
  // them is one thing that happened to the board, so the history is told to start a step here and
  // to stop one there - and closing covers both ways out, Escape and a click outside alike.
  useEffect(() => {
    undo?.boundary();
    return () => {
      undo?.boundary();
    };
  }, [undo]);

  /** Show `next`, and afterwards put the caret at `caret` once it is in the DOM. */
  const show = (next: string, caret?: number): void => {
    setValue(next);
    if (caret !== undefined) {
      caretRef.current = caret;
    }
  };

  /** Clamp, show, and write what this person changed - and nothing that anyone else did. */
  const write = (next: string): void => {
    const el = ref.current;
    const clamped = clampToLimit(next);
    if (el !== null && clamped !== next) {
      // Nothing beyond the limit is ever added; the caret lands at the end of the kept text.
      el.value = clamped;
      setCaretToEnd(el);
    }
    show(clamped);
    applyLocalEdit(ytext, baselineRef.current, clamped, LOCAL_ORIGIN);
    // The document's own text, rather than what we meant to put in it: if the two ever
    // disagree, it is the document that is right.
    baselineRef.current = ytext.toString();
  };

  // Somebody else's change to this note's text, arriving while it is being edited. The
  // textarea shows what the note holds, and the note holds both people's letters - every
  // keystroke of this person's went into it as it was typed - so what is left to work out is
  // where the caret is afterwards. Changes this editor made itself are ignored: the textarea
  // already has them.
  useEffect(() => {
    const onText = (event: Y.YEvent<Y.Text>, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN) {
        return;
      }
      const remote = ytext.toString();
      const baseline = baselineRef.current;
      if (remote === baseline) {
        return;
      }
      if (composingRef.current) {
        // Mid-word in Japanese input: putting text into the textarea underneath an underlined
        // composition would break the composition, so this waits for it to end (see below).
        pendingRef.current = { from: baseline, to: remote };
        return;
      }
      baselineRef.current = remote;
      const el = ref.current;
      if (el === null) {
        return;
      }
      const caret = mapCaret(event.delta as unknown as TextDeltaOp[], el.selectionStart);
      show(remote, caret);
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        // A textarea that cannot take a selection still shows the text.
      }
    };
    ytext.observe(onText);
    return () => {
      ytext.unobserve(onText);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `show` only touches refs and
    // setState, so the version from the first render stays correct; `ytext` is the thing that
    // would have to be re-subscribed to.
  }, [ytext]);

  // Mount: take the focus with the caret at the end of the existing text. Later runs of
  // this effect only re-fit the font, which is what keeps long notes readable.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    if (!mountedRef.current) {
      mountedRef.current = true;
      el.focus();
      setCaretToEnd(el);
    }
    const caret = caretRef.current;
    if (caret !== null) {
      // Writing a value into a textarea puts the caret at the end; this is where it belonged.
      caretRef.current = null;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        // A textarea that cannot take a selection still shows the text.
      }
    }
    const fit = fitFontSize(el, textBox(el));
    setFont(fit.fontPx);
    setOverflow(fit.overflow);
  }, [value]);

  // A pointerdown outside the note ends editing (and deselects), whatever element it
  // lands on. Capture phase, so it runs before the board's own pointer handling.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const el = ref.current;
      const target = event.target;
      if (el === null || !(target instanceof Element)) {
        return;
      }
      const note = noteElementOf(el);
      if (note !== null && note.contains(target)) {
        return;
      }
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  const onInput = (event: FormEvent<HTMLTextAreaElement>): void => {
    // Composition (e.g. Japanese input) is written when it finishes, not mid-keystroke.
    if (composingRef.current) {
      return;
    }
    write(event.currentTarget.value);
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>): void => {
    composingRef.current = false;
    const el = event.currentTarget;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) {
      // Somebody changed the text while this composition was open. The characters the
      // composition added go in, and nothing that arrived in the meantime is taken out: see
      // `applyAddedText`.
      applyAddedText(ytext, pending.from, el.value, LOCAL_ORIGIN);
      baselineRef.current = ytext.toString();
      show(baselineRef.current);
      setCaretToEnd(el);
      return;
    }
    write(el.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      // The text is already in the document; stopping editing writes nothing more.
      event.preventDefault();
      event.stopPropagation();
      onEndRef.current('selected');
      return;
    }
    // Enter is left to the textarea, which inserts a newline.
    const meta = event.metaKey || event.ctrlKey;
    if (
      undo !== undefined &&
      meta &&
      (event.key === 'z' || event.key === 'Z' || event.key === 'y' || event.key === 'Y')
    ) {
      // Taken from the browser either way: the page's own undo would wind the textarea back behind
      // the document, and the two would never agree again. What it does instead is undo this
      // person's last step, which is the same thing as pressing the key anywhere else on the board.
      event.preventDefault();
      event.stopPropagation();
      const redoing = event.key === 'y' || event.key === 'Y' || event.shiftKey;
      if (redoing) {
        undo.redo();
      } else {
        undo.undo();
      }
    }
  };

  const onBlur = (): void => {
    // Defensive: a blur in the middle of a composition would otherwise lose those
    // characters. Normal typing has already been written, so this changes nothing.
    const el = ref.current;
    if (el !== null && composingRef.current) {
      composingRef.current = false;
      write(el.value);
    }
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-note__editor"
        data-testid="sticky-note-editor"
        aria-label="Sticky note text"
        value={value}
        style={{ fontSize: `${font}px` }}
        spellCheck={false}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onBlur={onBlur}
        onPointerDown={(event: ReactPointerEvent<HTMLTextAreaElement>) => {
          // Clicking in the text must not start a drag of the note.
          event.stopPropagation();
        }}
        onDoubleClick={(event: ReactMouseEvent<HTMLTextAreaElement>) => {
          event.stopPropagation();
        }}
      />
      {counterVisible(value.length) ? (
        <div
          className="sticky-note__counter"
          data-testid="sticky-note-counter"
          data-length={value.length}
          role="status"
        >
          {`${value.length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      ) : null}
      {overflow ? (
        <div
          className="sticky-note__fade"
          data-testid="sticky-note-fade"
          data-overflow="true"
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
