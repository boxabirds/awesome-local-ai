import { useState } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

export function StickyTextEditor(props: {
  ytext: Y.Text; fontPx: number; onEnd(next: 'selected' | 'unselected'): void; undo?: UndoController;
}) {
  const [length, setLength] = useState(() => props.ytext.length);
  return (
    <>
      <TextEditor
        ytext={props.ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={props.fontPx}
        width="auto"
        className="sticky-editor"
        ariaLabel="Note text"
        onInput={() => {}}
        onEnd={props.onEnd}
        undo={props.undo}
        onLength={setLength}
      />
      {counterVisible(length) && (
        <span className="sticky-counter" data-testid="sticky-counter">{length}/{STICKY_TEXT_MAX_CHARS}</span>
      )}
    </>
  );
}
