import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { counterVisible, fitFontSize, STICKY_TEXT_PADDING } from './StickyText';
import { TextEditor } from './TextEditor';
import type { UndoController } from '../board/undo';

const TEXT_BOX = STICKY_SIZE_WORLD - STICKY_TEXT_PADDING * 2;

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size (board units) the display mode currently uses; re-fitted while typing. */
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Story 8: the undo controller for this board. */
  undo?: UndoController;
}

/**
 * Text editing for one sticky note (story 2): a thin wrapper over the shared
 * `TextEditor` (story 9) with sticky defaults — STICKY_TEXT_MAX_CHARS limit,
 * auto-fit font, char counter, centred padding.
 */
export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd, undo } = props;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [sizePx, setSizePx] = useState(fontPx);
  const [overflow, setOverflow] = useState(false);
  const [value, setValue] = useState(() => ytext.toString());

  // Auto-fit the font on mount and on every text change (zoom scales
  // uniformly, so no refit on zoom).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const fit = fitFontSize(el, TEXT_BOX);
    setSizePx(fit.fontPx);
    setOverflow(fit.overflow);
  }, [value]);

  return (
    <div
      className={overflow ? 'sticky-text-editor sticky-fade' : 'sticky-text-editor'}
      style={{ position: 'absolute', inset: 0 }}
    >
      <TextEditor
        ytext={ytext}
        maxChars={STICKY_TEXT_MAX_CHARS}
        fontPx={sizePx}
        width="auto"
        onInput={() => {}}
        onEnd={onEnd}
        undo={undo}
        testId="sticky-text-editor"
        textareaTestId="sticky-textarea"
        textareaRef={textareaRef}
        onValue={setValue}
        textareaStyle={{
          padding: STICKY_TEXT_PADDING,
          color: '#222',
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1.2,
        }}
      />
      {counterVisible(value.length) && (
        <span
          data-testid="char-counter"
          aria-label={`Character count ${value.length} of ${STICKY_TEXT_MAX_CHARS}`}
          style={{
            position: 'absolute',
            right: 4,
            bottom: 2,
            fontSize: 10,
            lineHeight: 1,
            color: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
