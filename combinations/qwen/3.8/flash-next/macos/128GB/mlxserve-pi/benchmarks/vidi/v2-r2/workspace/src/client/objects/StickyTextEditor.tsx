// The caret the user types an idea into. Mounted only while a note is being
// edited, so a selected note is a plain div again as soon as editing ends.
//
// Contract with the note: every keystroke is already in the Y.Text when the
// editor goes away, so ending editing writes nothing.
//   Escape            -> onEnd('selected')     (keeps the note selected)
//   pointerdown outside the note -> onEnd('unselected')
// Characters past STICKY_TEXT_MAX_CHARS are dropped as they arrive, which is why
// a paste of 1,200 characters leaves exactly the first 1,000 in the note.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type * as Y from 'yjs';
import { STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import type { EndEditNext } from '../board/useSelection';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
  NOTE_PADDING_WORLD,
} from './StickyText';

/** Height the text may use: the note minus its padding, in world units. */
export const TEXT_BOX_WORLD = STICKY_SIZE_WORLD - NOTE_PADDING_WORLD * 2;

/** Attribute the note root carries, used to tell clicks inside from outside. */
export const NOTE_ATTRIBUTE = 'data-note-id';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note measured before handing over, as a starting point. */
  fontPx: number;
  /**
   * Height the text may use, world units - the note's height minus its
   * padding. Defaults to the standard note's; a resized note (story 7)
   * passes its own, so the auto-fit answers for the box the user made.
   */
  boxWorld?: number;
  onEnd(next: EndEditNext): void;
}

export function StickyTextEditor({
  ytext,
  fontPx,
  boxWorld = TEXT_BOX_WORLD,
  onEnd,
}: StickyTextEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const [size, setSize] = useState<{ fontPx: number; overflow: boolean }>({ fontPx, overflow: false });
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

  /** Re-measure the font after the text changed. */
  const measure = useCallback((): void => {
    const el = ref.current;
    if (el === null) return;
    const fit = fitFontSize(el, Math.max(0, boxWorld));
    setSize((previous) =>
      previous.fontPx === fit.fontPx && previous.overflow === fit.overflow
        ? previous
        : { fontPx: fit.fontPx, overflow: fit.overflow },
    );
  }, [boxWorld]);

  // Editing starts with the caret at the end of whatever the note already says,
  // so continuing a thought does not need a click.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.focus();
    const length = el.value.length;
    el.setSelectionRange(length, length);
    measure();
  }, [measure]);

  // A pointerdown anywhere outside the note finishes editing and deselects. It
  // runs in the capture phase so it lands before the clicked thing takes the
  // click for itself: clicking another note selects that one, not nothing.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current;
      if (el === null) return;
      const note = el.closest(`[${NOTE_ATTRIBUTE}]`);
      const target = event.target as Node | null;
      if (note !== null && target !== null && note.contains(target)) return;
      end('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  }, [end]);

  // The value is written to the document on every input, so unmounting (a note
  // deleted from elsewhere, a reload) cannot lose a character.
  useEffect(
    () => () => {
      const el = ref.current;
      if (el === null || composingRef.current) return;
      applyTextDiff(ytext, clampToLimit(el.value), LOCAL_ORIGIN);
    },
    [ytext],
  );

  // A remote edit to this note must land in the textarea too, or the next local
  // keystroke's diff would delete it (story 3 merges concurrent typing). We skip
  // our own writes and any in-flight IME composition, and keep the caret the same
  // distance from the end so typing continues where the user left off.
  useEffect(() => {
    const onRemote = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.origin === LOCAL_ORIGIN || composingRef.current) return;
      const el = ref.current;
      const next = clampToLimit(ytext.toString());
      setValue(next);
      if (el !== null) {
        const afterCaret = el.value.length - el.selectionEnd;
        const caret = Math.min(Math.max(0, next.length - afterCaret), next.length);
        el.value = next;
        el.setSelectionRange(caret, caret);
      }
      measure();
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
  }, [ytext, measure]);

  const applyValue = useCallback(
    (next: string): void => {
      const kept = clampToLimit(next);
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
    },
    [measure, ytext],
  );

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    // While an input method is composing, the browser is still assembling the
    // text; the compositionend handler writes it once it is final.
    if (composingRef.current) return;
    applyValue(event.target.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter belongs to the note: it adds a line. Only Escape leaves editing.
    if (event.key === 'Escape') {
      event.preventDefault();
      end('selected');
    }
  };

  return (
    <>
      <textarea
        ref={ref}
        className={`sticky-input${size.overflow ? ' has-overflow' : ''}`}
        data-testid="sticky-text"
        data-font-px={size.fontPx}
        data-overflow={size.overflow}
        style={{ fontSize: `${size.fontPx}px` }}
        value={value}
        aria-label="Sticky note text"
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
      {counterVisible(value.length) ? (
        <span className="sticky-counter" data-testid="sticky-counter" aria-live="polite">
          {value.length}
          /{STICKY_TEXT_MAX_CHARS}
        </span>
      ) : null}
      {size.overflow ? <span className="sticky-fade" data-testid="sticky-fade" aria-hidden="true" /> : null}
    </>
  );
}
