/**
 * In-place text editor of a sticky note (anchors: sticky.edit_start, sticky.edit_end,
 * sticky.text_limit): story 9's shared `TextEditor` with the sticky note limit, the
 * vertical centring offset and the n/1000 counter.
 */
import { useContext, useEffect, useState, type CSSProperties } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { counterVisible } from './StickyText';
import { TextEditor } from './TextEditor';
import { UndoContext } from '../board/useUndo';

export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Extra top padding (world units) that vertically centres short text like display mode. */
  offsetTop?: number;
}): React.JSX.Element {
  const { ytext } = props;
  const [length, setLength] = useState(() => ytext.length);
  const history = useContext(UndoContext);

  // The counter follows every change, local or remote.
  useEffect(() => {
    const onChange = () => setLength(ytext.length);
    onChange();
    ytext.observe(onChange);
    return () => ytext.unobserve(onChange);
  }, [ytext]);

  const style: CSSProperties = {
    paddingTop: props.offsetTop === undefined ? undefined : `calc(var(--sticky-padding) + ${props.offsetTop}px)`,
  };

  return (
    <>
      <TextEditor
        ytext={ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={props.fontPx}
        width="auto"
        onInput={() => undefined}
        onEnd={props.onEnd}
        undo={history}
        className="sticky-editor"
        ariaLabel="Note text"
        style={style}
      />
      {counterVisible(length) && (
        <div className="sticky-counter" data-testid="sticky-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </div>
      )}
    </>
  );
}
