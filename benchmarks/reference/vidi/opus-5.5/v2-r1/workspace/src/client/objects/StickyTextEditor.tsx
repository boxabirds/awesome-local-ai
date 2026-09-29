import type { CSSProperties } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

/** A sticky note's editor (story 2): the shared TextEditor with the note limit and counter. */
export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  style?: CSSProperties;
}) {
  return (
    <TextEditor
      ytext={props.ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={props.fontPx}
      width="auto"
      onEnd={props.onEnd}
      ariaLabel="Note text"
      className="sticky-editor"
      style={props.style}
      after={(length) =>
        counterVisible(length) && (
          <div className="sticky-counter" aria-live="polite">
            {`${length}/${STICKY_TEXT_MAX_CHARS}`}
          </div>
        )
      }
    />
  );
}
