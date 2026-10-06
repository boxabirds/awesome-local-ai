import { useCallback } from "react";
import type * as Y from "yjs";
import { STICKY_FONT_MAX_PX, STICKY_TEXT_BOX_WORLD, STICKY_TEXT_MAX_CHARS } from "../../shared/config";
import { counterVisible, fitFontSize, textBoxStyle } from "./StickyText";
import { TextEditor } from "./TextEditor";
import { useUndoController } from "../board/useUndo";

/**
 * The textarea that edits a note's `Y.Text` (`sticky.editing`).
 *
 * Story 9 moved everything general into `TextEditor` — the uncontrolled field,
 * the minimal `Y.Text` diff, the remote-typing sync, the undo keys, the
 * composition rules and the edit-start/edit-end undo boundaries. What is
 * specific to a note stays here: its 1000-character limit, its counter, and the
 * auto-fit that shrinks the font until the text fits the note's box.
 */
export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size the note is currently displaying; refined here by measuring. */
  fontPx: number;
  onEnd(next: "selected" | "unselected"): void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const undo = useUndoController();

  const fit = useCallback(
    (el: HTMLTextAreaElement) => fitFontSize(el, STICKY_TEXT_BOX_WORLD),
    [],
  );

  const counter = useCallback(
    (length: number) =>
      counterVisible(length) ? (
        <span className="sticky-note-counter" data-testid="sticky-note-counter" aria-live="polite">
          {`${length}/${STICKY_TEXT_MAX_CHARS}`}
        </span>
      ) : null,
    [],
  );

  return (
    <TextEditor
      ytext={ytext}
      maxChars={STICKY_TEXT_MAX_CHARS}
      fontPx={Number.isFinite(fontPx) && fontPx > 0 ? fontPx : STICKY_FONT_MAX_PX}
      width="auto"
      onInput={() => undefined}
      onEnd={onEnd}
      undo={undo}
      className="sticky-note-text sticky-note-editor"
      testId="sticky-note-input"
      ariaLabel="Sticky note text"
      fieldStyle={textBoxStyle()}
      fitFont={fit}
      renderExtra={counter}
    />
  );
}
