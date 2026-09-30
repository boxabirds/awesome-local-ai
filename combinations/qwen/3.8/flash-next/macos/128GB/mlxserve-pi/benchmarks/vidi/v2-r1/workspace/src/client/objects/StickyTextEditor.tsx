import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import {
  applyTextDiff,
  clampToLimit,
  counterVisible,
  fitFontSize,
  stickyTextContentBox,
  STICKY_TEXT_PADDING_WORLD,
} from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note's display had when editing started; re-fit from here. */
  fontPx: number;
  /** Escape -> 'selected'; pointerdown outside the note -> 'unselected'. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * A textarea that writes straight into the note's shared Y.Text with a minimal
 * diff, clamps to the character limit, auto-fits its font size, and ends editing
 * on Escape or an outside click. Every `input` is already committed, so ending
 * editing performs no extra write.
 */
export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
}: StickyTextEditorProps): ReactNode {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [font, setFont] = useState(fontPx);
  const [overflow, setOverflow] = useState(false);
  const [length, setLength] = useState(() => ytext.toString().length);

  /** Re-measure the textarea and update font / overflow state (idempotent). */
  const measure = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    const result = fitFontSize(el, stickyTextContentBox());
    setFont((prev) => (prev === result.fontPx ? prev : result.fontPx));
    setOverflow((prev) => (prev === result.overflow ? prev : result.overflow));
  }, []);

  /** Clamp + write the raw textarea value into the shared text, then re-fit. */
  const writeValue = useCallback(
    (raw: string): void => {
      const el = ref.current;
      if (!el) return;
      const clamped = clampToLimit(raw);
      if (clamped !== raw) {
        el.value = clamped;
        const pos = clamped.length;
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          // selection unsupported in this environment; ignore
        }
      }
      applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
      setLength(clamped.length);
      measure();
    },
    [ytext, measure],
  );

  // Mount: seed the textarea from the shared text, focus, caret at the end.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    setLength(el.value.length);
    measure();
    el.focus();
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      // selection unsupported in this environment; ignore
    }
  }, [ytext, measure]);

  // A remote change to the same text — the other person typing in this very
  // note while we are in it — arrives in `ytext` before it can appear on this
  // screen. The textarea holds its own value, so it has to be brought in line:
  // writing the stale local value back would delete their characters. The caret
  // stays where it can, and the next keystroke goes in on top of the merged text.
  useEffect(() => {
    const onRemoteText = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
      if (transaction.local) return; // our own writes: the textarea is already ahead
      const el = ref.current;
      if (!el) return;
      const next = ytext.toString();
      const selectionStart = el.selectionStart ?? next.length;
      const selectionEnd = el.selectionEnd ?? next.length;
      el.value = next;
      const from = Math.min(selectionStart, next.length);
      const to = Math.min(Math.max(selectionEnd, from), next.length);
      try {
        el.setSelectionRange(from, to);
      } catch {
        // selection unsupported in this environment; ignore
      }
      setLength(next.length);
      measure();
    };
    ytext.observe(onRemoteText);
    return () => {
      ytext.unobserve(onRemoteText);
    };
  }, [ytext, measure]);

  // A pointerdown anywhere outside the note ends editing as 'unselected'.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const el = ref.current;
      if (!el) return;
      const note = el.closest('[data-testid="sticky-note"]');
      if (note && event.target instanceof Node && note.contains(event.target)) return;
      onEnd('unselected');
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [onEnd]);

  const onInput = (): void => {
    if (composingRef.current) return; // wait for compositionend (IME)
    const el = ref.current;
    if (el) writeValue(el.value);
  };

  const onCompositionEnd = (): void => {
    composingRef.current = false;
    const el = ref.current;
    if (el) writeValue(el.value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEnd('selected');
    }
    // Enter is left to the textarea so it inserts a newline.
  };

  const onBlur = (): void => {
    // Defensive flush; every input is already committed. Guarded so a note that
    // vanished mid-edit (stale text) is not written to.
    const el = ref.current;
    if (!el || !ytext.doc) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== ytext.toString()) applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
  };

  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    margin: 0,
    border: 'none',
    outline: 'none',
    resize: 'none',
    background: 'transparent',
    color: '#1f2328',
    fontFamily: 'var(--vidi6-font)',
    lineHeight: 1.25,
    padding: `${STICKY_TEXT_PADDING_WORLD}px`,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
    fontSize: `${font}px`,
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  return (
    <>
      <textarea
        ref={ref}
        data-testid="sticky-note-text"
        data-overflow={overflow ? 'true' : 'false'}
        className={
          overflow
            ? 'sticky-note__text sticky-note__text--overflow'
            : 'sticky-note__text'
        }
        style={style}
        spellCheck={false}
        aria-label="Sticky note text"
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={onCompositionEnd}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {counterVisible(length) ? (
        <span data-testid="sticky-note-counter" style={counterStyle}>
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </span>
      ) : null}
    </>
  );
}

const counterStyle: CSSProperties = {
  position: 'absolute',
  right: 6,
  bottom: 4,
  fontSize: 11,
  lineHeight: 1,
  color: 'rgba(31, 35, 40, 0.6)',
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'none',
};
