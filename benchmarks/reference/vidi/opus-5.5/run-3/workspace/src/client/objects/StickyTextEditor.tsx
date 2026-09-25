import { useContext } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { UndoContext } from '../board/useUndo';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

const noop = () => {};

/**
 * A note's text editor (story 2): the shared TextEditor with the note limit, the note's styling and the character
 * counter near the limit. `paddingTop` lines the text up with the vertically centred display text.
 */
export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  paddingTop?: number;
  onEnd(next: 'selected' | 'unselected'): void;
}) {
  const undo = useContext(UndoContext);
  return (
    <TextEditor
      ytext={props.ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={props.fontPx}
      width="auto"
      onInput={noop}
      onEnd={props.onEnd}
      undo={undo}
      className="sticky-note__editor"
      ariaLabel="Note text"
      style={{ paddingTop: props.paddingTop }}
      renderExtra={(length) =>
        counterVisible(length) && (
          <div className="sticky-note__counter" data-testid="note-counter" aria-live="polite">
            {`${length}/${STICKY_TEXT_MAX_CHARS}`}
          </div>
        )
      }
    />
  );
}
