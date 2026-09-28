/**
 * Text editing overlay for a sticky note.
 * Thin wrapper around the generalised `TextEditor` (story 9).
 * Preserves story 2's interface (fontPx, onEnd, undo) and sticky-specific
 * character counter.
 */
import type { JSX } from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  undo?: UndoController;
}): JSX.Element {
  return <StickyTextEditorInner {...props} />;
}

import { useCallback, useState } from 'react';

function StickyTextEditorInner(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  undo?: UndoController;
}): JSX.Element {
  const [textLen, setTextLen] = useState(() => props.ytext.toString().length);

  const handleInput = useCallback(() => {
    setTextLen(props.ytext.toString().length);
  }, [props.ytext]);

  const showCounter = counterVisible(textLen);

  return (
    <div className="sticky-editor">
      <TextEditor
        ytext={props.ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={props.fontPx}
        width="auto"
        onInput={handleInput}
        onEnd={props.onEnd}
        undo={props.undo}
      />
      {showCounter && (
        <span className="sticky-counter" data-testid="sticky-counter">
          {textLen}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
