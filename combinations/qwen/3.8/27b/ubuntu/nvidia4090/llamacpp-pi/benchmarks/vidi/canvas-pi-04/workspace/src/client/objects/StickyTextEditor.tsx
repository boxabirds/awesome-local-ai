// Story 2: sticky note text editor (anchor: sticky.text).
//
// Story 9: this is now a thin wrapper around the shared TextEditor
// (src/client/objects/TextEditor.tsx), which generalises the diff/caret/
// limit/undo behaviour. The sticky-note-specific parts stay here:
//  - STICKY_TEXT_MAX_CHARS (vs TEXT_MAX_CHARS for text objects);
//  - the font-fit hook (the note binary-searches the font size on the
//    textarea, so no fontPx is passed);
//  - the char counter (renderExtras);
//  - the sticky editor class names (the note CSS depends on them).
//
// Story 3's behaviour is unchanged:
//  - every keystroke is written to the doc immediately (nothing is buffered
//    and nothing is lost when editing ends or the note is deleted);
//  - remote updates arriving while this note is edited merge into the
//    textarea, and the caret is remapped with Yjs relative positions so
//    concurrent typing by two people keeps every character (PRD
//    live.concurrent_text).

import type { JSX, RefObject } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';
import { useUndoController } from '../board/useUndo';

export function StickyTextEditor(props: {
  ytext: Y.Text;
  /** Attach this to the textarea so the note can measure and fit the font. */
  textRef: RefObject<HTMLElement | null>;
  /** The note root; a pointerdown inside it does not end editing. */
  rootRef: RefObject<HTMLElement | null>;
  onEnd: (next: 'selected' | 'unselected') => void;
}): JSX.Element {
  const undo = useUndoController();
  return (
    <TextEditor
      ytext={props.ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      width="auto"
      undo={undo}
      textRef={props.textRef}
      rootRef={props.rootRef}
      ariaLabel="Sticky note text"
      wrapperClassName="sticky-note__editor"
      textareaClassName="sticky-note__textarea"
      renderExtras={(value) =>
        counterVisible(value.length) ? (
          <div className="sticky-note__counter" aria-hidden="true">
            {value.length}/{STICKY_TEXT_MAX_CHARS}
          </div>
        ) : null
      }
      onEnd={props.onEnd}
    />
  );
}
