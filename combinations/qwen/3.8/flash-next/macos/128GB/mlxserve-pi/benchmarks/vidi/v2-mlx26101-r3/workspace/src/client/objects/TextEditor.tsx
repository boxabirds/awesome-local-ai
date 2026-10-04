import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  CompositionEvent,
  FormEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import type { UndoController } from '../board/undo';
import type { EditEnd } from '../board/useSelection';
import { applyAddedText, applyLocalEdit, clampToLimit, mapCaret, type TextDeltaOp } from '../../shared/text-edit';
import type { FontFit } from './StickyText';

/**
 * The result of fitting text to a box, from where the fitting is done ({@link StickyText}). Both
 * object types that edit text hand one of these to their editor, and neither of them wants to know
 * which file the arithmetic lives in.
 */
export type { FontFit };

/** What the object type is shown alongside the textarea it does not own. */
export interface TextEditorView {
  /** What the textarea holds, which is what the document holds. */
  readonly value: string;
  /** The font the text is being drawn at right now. */
  readonly fontPx: number;
  /** Whether the text is known to be too much for the box around it. */
  readonly overflow: boolean;
  /** The most this editor will let anybody put in. */
  readonly maxLength: number;
}

export interface TextEditorProps {
  /** The object's text: the value that survives, written to on every input event. */
  ytext: Y.Text;
  /** Font size to open at. A text object's is the size it was set to; a note's is the size it fitted. */
  fontPx: number;
  /** Escape (stay selected) or a click outside (deselect). */
  onEnd(next: EditEnd): void;
  /**
   * The most characters this type allows, and the number a paste longer than that is cut to. It is
   * a prop and not a constant because a sticky note and a free text object have different ones:
   * the note is a fixed square that has to hold what is in it, the text object grows, so it can be
   * allowed a great deal more. See {@link clampToLimit}.
   */
  maxLength: number;
  /** Class, test id and label of the textarea: the object type's own, so its tests still find it. */
  className: string;
  testId: string;
  ariaLabel: string;

  /**
   * This person's undo history. A spell of typing is one step rather than one per letter, and the
   * boundary of that step is known here and nowhere else - the editor knows when the object was
   * opened and when it was closed, and the history does not. While this textarea has the keyboard,
   * Ctrl/Cmd+Z is this object's typing going back, not the browser's own undo of the textarea.
   * Left out, the editor neither opens a step nor answers the key.
   */
  undo?: UndoController;
  /**
   * The attribute that marks the object this editor is inside of, for the "outside the object"
   * hit test: a press anywhere else ends editing.
   */
  hostAttribute: string;
  /**
   * Width of the textarea in world units, or `null` to let it be as wide as the object. Only used
   * by a text object in fixed mode: the box was dragged to a width, and the line has to break at
   * that width while it is typed, not afterwards.
   */
  widthPx?: number | null;
  /** Where the caret goes when editing opens: after the text, or all of it selected. */
  start?: 'end' | 'select-all';
  /**
   * Shrink the font so the text fits the box, called whenever the text changes - which is what a
   * sticky note does with a fixed square to fit into. A text object leaves it out: its size is one
   * of four choices somebody made, and text that outgrows the box gets a line instead of a smaller
   * font. The shape is `fitFontSize`'s, which is the only fitter there is.
   */
  refit?: (el: HTMLTextAreaElement, currentFontPx: number) => FontFit;
  /**
   * Something was typed here and is already in the document. This is the moment to re-measure the
   * box around the text: the only client that can see the new characters is the one typing them,
   * so it is the one that has to say how wide they are (story 9).
   */
  onLocalTextChange?: (value: string) => void;
  /** Whatever the object type shows with its textarea - a note's counter and its fade. */
  render?: (view: TextEditorView) => ReactNode;
}

/** Put the caret at the end of the textarea, if it will take one. */
function setCaretToEnd(el: HTMLTextAreaElement): void {
  const end = el.value.length;
  try {
    el.setSelectionRange(end, end);
  } catch {
    // A textarea that cannot take a selection still shows the text.
  }
}

/** Select everything, so the first keystroke replaces what is there. */
function selectAll(el: HTMLTextAreaElement): void {
  try {
    el.setSelectionRange(0, el.value.length);
  } catch {
    // As above: nothing is lost but the shortcut.
  }
}

/** Put the caret at `caret`, if it will take one. */
function setCaret(el: HTMLTextAreaElement, caret: number): void {
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    // A textarea that cannot take a selection still shows the text.
  }
}

/**
 * The textarea that appears inside an object while it is being edited: a sticky note's or a text
 * object's.
 *
 * One editor for both, because everything hard in text editing is the same for both, and it is all
 * about two people being in the same `Y.Text` at once:
 *
 * - every keystroke is written to the document immediately, so stopping needs no save;
 * - a keystroke is written as the *difference it made* (`applyLocalEdit`), never as the whole value
 *   of the textarea, which is what keeps somebody else's letters in while you are typing;
 * - a change from anywhere else is shown as it arrives, and the caret is put where it belongs
 *   afterwards (`mapCaret`);
 * - Japanese input waits for the composition to end before anything is written;
 * - text longer than the type's own limit is cut off, with the caret at the end of what was kept.
 *
 * What is *not* here is everything that differs between the two objects: how big the font is, how
 * much text is allowed, whether a counter is shown, how wide the box is. Those come in as props -
 * {@link TextEditorProps.refit}, {@link TextEditorProps.maxLength},
 * {@link TextEditorProps.render}, {@link TextEditorProps.widthPx} - and are answered by
 * `StickyTextEditor` and by `TextObject` respectively. Escape keeps the object selected, a pointer
 * press outside it deselects, and Enter inserts a newline rather than closing the editor.
 */
export function TextEditor({
  ytext,
  fontPx,
  onEnd,
  maxLength,
  className,
  testId,
  ariaLabel,
  hostAttribute,
  undo,
  widthPx = null,
  start = 'end',
  refit,
  onLocalTextChange,
  render,
}: TextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState<string>(() => ytext.toString());
  const [font, setFont] = useState<number>(fontPx);
  const [overflow, setOverflow] = useState(false);
  const composingRef = useRef(false);
  const mountedRef = useRef(false);
  const onEndRef = useRef(onEnd);
  const onLocalTextChangeRef = useRef(onLocalTextChange);

  // The text this editor last saw in the document, whether from its own typing or from somebody
  // else's. Keystrokes are written as the difference from it, which is what keeps somebody else's
  // letters in the object: see `applyLocalEdit`.
  const baselineRef = useRef<string>(ytext.toString());
  // A caret to put back once React has written a new value into the textarea - React resets it.
  const caretRef = useRef<number | null>(null);
  // A change that arrived in the middle of Japanese input: the text it went to, and the text it
  // went from.
  const pendingRef = useRef<{ from: string; to: string } | null>(null);

  useEffect(() => {
    onEndRef.current = onEnd;
    onLocalTextChangeRef.current = onLocalTextChange;
  });

  // Opening the object and closing it are the two ends of one undo step. Everything typed between
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

  /**
   * One thing this client did to the board, in one transaction.
   *
   * A keystroke of text and the box that text needs are one change to one object, and they leave
   * this client as one update - which is what everybody else on the board hears about it. Written
   * as two updates it would work too, and cost twice the messages on the wire for each letter, on a
   * board where five people typing at once is the case that already has the most traffic; and a
   * peer would briefly see the new letters inside the old box. A text object with no owner to
   * measure it is a text object with no box at all, so the two are written together or not at all.
   */
  const locally = (change: () => void): void => {
    const doc = ytext.doc;
    if (doc === null) {
      change();
      return;
    }
    doc.transact(change, LOCAL_ORIGIN);
  };

  /** Clamp, show, and write what this person changed - and nothing that anyone else did. */
  const write = (next: string): void => {
    const el = ref.current;
    const clamped = clampToLimit(next, maxLength);
    if (el !== null && clamped !== next) {
      // Nothing beyond the limit is ever added; the caret lands at the end of the kept text.
      el.value = clamped;
      setCaretToEnd(el);
    }
    show(clamped);
    locally(() => {
      applyLocalEdit(ytext, baselineRef.current, clamped, LOCAL_ORIGIN);
      // The document's own text, rather than what we meant to put in it: if the two ever disagree,
      // it is the document that is right.
      baselineRef.current = ytext.toString();
      // The text is in the document now, which is the point at which the box around it is known to
      // be the wrong size. Measuring is the object's business, not this component's.
      onLocalTextChangeRef.current?.(baselineRef.current);
    });
  };

  // Somebody else's change to this text, arriving while it is being edited. The textarea shows what
  // the document holds, and the document holds both people's letters - every keystroke of this
  // person's went into it as it was typed - so what is left to work out is where the caret is
  // afterwards. Changes this editor made itself are ignored: the textarea already has them.
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
      setCaret(el, caret);
    };
    ytext.observe(onText);
    return () => {
      ytext.unobserve(onText);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `show` only touches refs and
    // setState, so the version from the first render stays correct; `ytext` is the thing that
    // would have to be re-subscribed to.
  }, [ytext]);

  // Mount: take the focus with the caret at the end of the existing text. Later runs of this effect
  // only re-fit the font, which is what keeps long notes readable.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    if (!mountedRef.current) {
      mountedRef.current = true;
      el.focus();
      if (start === 'select-all') {
        selectAll(el);
      } else {
        setCaretToEnd(el);
      }
    }
    const caret = caretRef.current;
    if (caret !== null) {
      // Writing a value into a textarea puts the caret at the end; this is where it belonged.
      caretRef.current = null;
      setCaret(el, caret);
    }
    if (refit !== undefined) {
      const fit = refit(el, font);
      setFont(fit.fontPx);
      setOverflow(fit.overflow);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `font` is read, not written, by the
    // fitting; re-running on a font change would fit in a loop.
  }, [value, refit, start]);

  // A pointerdown outside the object ends editing (and deselects), whatever element it lands on.
  // Capture phase, so it runs before the board's own pointer handling.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const el = ref.current;
      const target = event.target;
      if (el === null || !(target instanceof Element)) {
        return;
      }
      const host = el.closest<HTMLElement>(`[${hostAttribute}]`);
      if (host !== null && host.contains(target)) {
        return;
      }
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [hostAttribute]);

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
      // Somebody changed the text while this composition was open. The characters the composition
      // added go in, and nothing that arrived in the meantime is taken out: see `applyAddedText`.
      locally(() => {
        applyAddedText(ytext, pending.from, el.value, LOCAL_ORIGIN);
        baselineRef.current = ytext.toString();
        show(baselineRef.current);
        setCaretToEnd(el);
        onLocalTextChangeRef.current?.(baselineRef.current);
      });
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
    // Defensive: a blur in the middle of a composition would otherwise lose those characters.
    // Normal typing has already been written, so this changes nothing.
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
        className={className}
        data-testid={testId}
        aria-label={ariaLabel}
        value={value}
        style={{
          fontSize: `${font}px`,
          ...(widthPx !== null && Number.isFinite(widthPx) ? { width: `${widthPx}px` } : {}),
        }}
        spellCheck={false}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onBlur={onBlur}
        onPointerDown={(event: ReactPointerEvent<HTMLTextAreaElement>) => {
          // Clicking in the text must not start a drag of the object.
          event.stopPropagation();
        }}
        onDoubleClick={(event: ReactMouseEvent<HTMLTextAreaElement>) => {
          event.stopPropagation();
        }}
      />
      {render?.({ value, fontPx: font, overflow, maxLength })}
    </>
  );
}
