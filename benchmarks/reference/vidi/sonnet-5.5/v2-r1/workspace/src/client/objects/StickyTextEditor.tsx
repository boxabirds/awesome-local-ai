import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';

const noop = () => undefined;

/** The sticky note flavour of the shared text editor: centred text, 1,000-character limit and a counter near it. */
export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}) {
  return (
    <TextEditor
      ytext={props.ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={props.fontPx}
      width="auto"
      onInput={noop}
      onEnd={props.onEnd}
      className="sticky-editor"
      ariaLabel="Note text"
      containerSelector="[data-sticky-note]"
      boundaryOnEmptyStart
      renderExtra={(length) =>
        counterVisible(length) && (
          <div className="sticky-counter" data-testid="sticky-counter">
            {length}/{STICKY_TEXT_MAX_CHARS}
          </div>
        )
      }
    />
  );
}
