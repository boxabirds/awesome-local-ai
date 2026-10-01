import { useState } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { useUndoController } from '../board/useUndo';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

/** The sticky note's editor: the shared text editor plus the 1,000-character counter. */
export function StickyTextEditor(props: {
  ytext: Y.Text; fontPx: number; onEnd(next: 'selected' | 'unselected'): void;
}) {
  const { ytext, fontPx, onEnd } = props;
  const [length, setLength] = useState(() => ytext.length);
  const undo = useUndoController();
  return (
    <>
      <TextEditor
        ytext={ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={fontPx}
        width="auto"
        label="Note text"
        className="sticky-editor"
        onInput={() => {}}
        onLengthChange={setLength}
        onEnd={onEnd}
        undo={undo}
      />
      {counterVisible(length) && (
        <span className="sticky-counter">{length}/{STICKY_TEXT_MAX_CHARS}</span>
      )}
    </>
  );
}
