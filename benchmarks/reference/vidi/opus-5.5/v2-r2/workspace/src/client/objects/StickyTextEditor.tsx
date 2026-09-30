import { useState } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { useUndoController } from '../board/useUndo';
import { STICKY_LINE_HEIGHT, STICKY_PADDING_WORLD, counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

/** Sticky note editor: the shared TextEditor with the note's limit, layout and character counter. */
export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}): React.JSX.Element {
  const [length, setLength] = useState(() => props.ytext.length);
  const undo = useUndoController();
  return (
    <>
      <TextEditor
        ytext={props.ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={props.fontPx}
        width="auto"
        onInput={() => {}}
        onEnd={props.onEnd}
        undo={undo}
        label="Sticky note text"
        className="sticky-editor"
        container="[data-sticky-note]"
        onLength={setLength}
        style={{ lineHeight: STICKY_LINE_HEIGHT, padding: `0 ${STICKY_PADDING_WORLD}px` }}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
