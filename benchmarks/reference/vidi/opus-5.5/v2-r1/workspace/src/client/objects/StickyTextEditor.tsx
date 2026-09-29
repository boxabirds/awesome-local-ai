import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import {
  type TextDelta,
  applyTextDiff,
  applyTextEditOver,
  clampEdit,
  counterVisible,
  transformIndex,
} from './StickyText';

/** True once the text (or the note containing it) has been deleted from the document. */
function isDetached(type: Y.AbstractType<any>): boolean {
  if (!type.doc) return true;
  let item = type._item;
  while (item) {
    if (item.deleted) return true;
    item = (item.parent as Y.AbstractType<any>)._item;
  }
  return false;
}

/**
 * Textarea editing a note's Y.Text. Each input is written immediately as a minimal diff,
 * so ending the edit needs no extra write. Other people's changes to the text appear in the
 * textarea as they arrive, with the caret kept in place (during IME composition they are
 * applied once composition ends, so the composition is not disturbed).
 */
export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  style?: CSSProperties;
}) {
  const { ytext } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [initial] = useState(() => ytext.toString());
  const [length, setLength] = useState(initial.length);
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;
  /** The text the textarea's content is based on: the Y.Text as of the last sync. */
  const shownRef = useRef(initial);
  /** Remote changes received while composing, not yet shown in the textarea. */
  const pendingRemoteRef = useRef<TextDelta[]>([]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // A press anywhere outside the note ends editing.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      const note = el?.closest('[data-sticky-id]') ?? el;
      if (note && e.target instanceof Node && note.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  // Show other people's edits as they arrive.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !isDetached(ytext) && ytext.toString() !== shownRef.current) {
      // Changed between the first render and subscribing.
      el.value = ytext.toString();
      shownRef.current = el.value;
      setLength(el.value.length);
    }
    const onRemote = (event: Y.YTextEvent, tr: Y.Transaction) => {
      const el = ref.current;
      if (!el || tr.origin === LOCAL_ORIGIN) return;
      const delta = event.delta as TextDelta;
      if (composingRef.current) {
        pendingRemoteRef.current.push(delta);
        return;
      }
      const { selectionStart, selectionEnd, selectionDirection } = el;
      el.value = ytext.toString();
      shownRef.current = el.value;
      el.setSelectionRange(
        transformIndex(selectionStart, delta),
        transformIndex(selectionEnd, delta),
        selectionDirection,
      );
      setLength(el.value.length);
    };
    ytext.observe(onRemote);
    return () => ytext.unobserve(onRemote);
  }, [ytext]);

  const sync = () => {
    const el = ref.current;
    if (!el || composingRef.current || isDetached(ytext)) return;
    const base = shownRef.current;
    if (el.value.length > STICKY_TEXT_MAX_CHARS) {
      const { text, caret } = clampEdit(base, el.value);
      el.value = text;
      el.setSelectionRange(caret, caret);
    }
    const remote = pendingRemoteRef.current;
    pendingRemoteRef.current = [];
    if (remote.length === 0) {
      applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    } else {
      // Remote changes arrived during composition: merge the local edit over them.
      const caret = applyTextEditOver(ytext, base, el.value, remote, LOCAL_ORIGIN);
      el.value = ytext.toString();
      el.setSelectionRange(caret, caret);
    }
    shownRef.current = el.value;
    setLength(el.value.length);
  };

  return (
    <>
      <textarea
        ref={ref}
        className="sticky-editor"
        aria-label="Note text"
        defaultValue={initial}
        style={{ ...props.style, fontSize: `${props.fontPx}px` }}
        onChange={(e) => {
          if (!(e.nativeEvent as InputEvent).isComposing) sync();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          sync();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
          e.preventDefault();
          e.stopPropagation();
          sync();
          props.onEnd('selected');
        }}
        onBlur={sync}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
