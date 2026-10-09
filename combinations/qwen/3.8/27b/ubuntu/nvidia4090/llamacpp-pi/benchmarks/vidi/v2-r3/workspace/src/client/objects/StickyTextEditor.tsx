import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  padding: number;
  /** The caller's undo controller (story 8). */
  undo: UndoController;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * Story 2: the sticky note editor — now a thin wrapper around the story 9
 * generalised TextEditor with the note's padding, centred alignment, the
 * note's character limit and the character counter.
 */
export function StickyTextEditor(props: StickyTextEditorProps): ReactElement {
  const { ytext, fontPx, padding, undo, onEnd } = props;
  const [length, setLength] = useState(() => ytext.toString().length);

  // Keep the counter in sync (local changes report through onInput; remote
  // changes arrive through the Y.Text observer).
  useEffect(() => {
    const handler = (_events: unknown, transaction: { origin: unknown }) => {
      if (transaction.origin === LOCAL_ORIGIN) return;
      setLength(ytext.toString().length);
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [ytext]);

  return (
    <div className="sticky-editor-wrap" style={{ position: 'absolute', inset: padding, zIndex: 5 }}>
      <TextEditor
        ytext={ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={fontPx}
        lineHeight={1.25}
        ariaLabel="Note text"
        textAlign="center"
        onInput={() => setLength(ytext.toString().length)}
        onEnd={onEnd}
        undo={undo}
      />
      {counterVisible(length) && (
        <div
          className="char-counter"
          aria-live="polite"
          style={{
            position: 'absolute',
            bottom: 2,
            right: 4,
            fontSize: 10,
            color: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          {Math.min(length, STICKY_TEXT_MAX_CHARS)}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
