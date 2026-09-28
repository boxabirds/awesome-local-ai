// The sticky note's text editor (story 2, sticky.text): a transparent
// textarea diffed minimally into the note's Y.Text. Every input event is
// committed immediately, so ending editing never writes anything extra —
// text typed so far is already in the document.

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** The editor has ended (Escape or blur); the caller decides the next
   *  selection/editing state (story 7 keeps the selection on Escape). */
  onEnd(): void;
}

export function StickyTextEditor(props: StickyTextEditorProps): ReactElement {
  const { ytext, fontPx, onEnd } = props;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const lastRef = useRef('');

  // On mount: value from Y.Text, focused, caret at the end of the text.
  // While editing, remote changes to the note's text are merged into the
  // textarea (caret moved to the end) so a concurrent editor's characters are
  // never deleted by this editor's next commit. Own commits (LOCAL_ORIGIN)
  // are skipped: they are already reflected in the textarea.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const initial = ytext.toString();
    lastRef.current = initial;
    ta.value = initial;
    ta.focus();
    ta.setSelectionRange(initial.length, initial.length);

    const onRemoteChange = (_event: unknown, transaction: Y.Transaction): void => {
      if (composingRef.current) return;
      if (transaction.origin === LOCAL_ORIGIN) return;
      ta.value = ytext.toString();
      lastRef.current = ta.value;
      ta.setSelectionRange(ta.value.length, ta.value.length);
    };
    ytext.observe(onRemoteChange);
    return () => ytext.unobserve(onRemoteChange);
  }, [ytext]);

  const commit = useCallback(
    (value: string) => {
      const kept = clampToLimit(value);
      if (kept !== lastRef.current) {
        applyTextDiff(ytext, kept, LOCAL_ORIGIN);
        lastRef.current = kept;
      }
      // If the value was truncated to the limit, restore the caret to the
      // end of the kept text.
      const ta = taRef.current;
      if (ta && ta.value.length > kept.length) {
        ta.setSelectionRange(kept.length, kept.length);
      }
    },
    [ytext],
  );

  const finish = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    // Defensive flush: every input event already committed, so this is a
    // no-op in practice (guards an uncommitted value, e.g. IME).
    const ta = taRef.current;
    if (ta && ta.value !== lastRef.current) commit(ta.value);
    onEnd();
  }, [commit, onEnd]);

  const length = ytext.toString().length;

  return (
    <div className="sticky-editor" data-testid="sticky-editor">
      <textarea
        ref={taRef}
        data-testid="sticky-editor-input"
        aria-label="Sticky note text"
        spellCheck={false}
        style={{ fontSize: fontPx }}
        onChange={(e) => {
          if (composingRef.current) return; // handled on compositionend
          commit(e.currentTarget.value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false;
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            finish();
          }
          // Enter intentionally not intercepted: it inserts a new line.
        }}
        onBlur={() => finish()}
      />
      {counterVisible(length) && (
        <span className="sticky-counter" data-testid="sticky-char-counter">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
