/**
 * Free text on the board (story 9): a heading, a label, an annotation.
 *
 * The object is plain text with no fill, placed by its top-left corner and drawn inside the box
 * the model stores (`width`/`height`). The box is not measured here: it is written by
 * `useTextBoxSync`, and only after this screen's own change, so every screen agrees on one set of
 * numbers for selection, marquee and sharing.
 *
 * Interaction is story 7's, through the props: pointerdown goes to the generic transform gesture,
 * double-click edits, and the toolbar offers the four sizes. What is text-specific is that the
 * height belongs to the content, and that text with no characters in it is not kept.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  deleteObject,
  type TextSnapshot,
} from '../../shared/board-model';
import {
  deleteIfEmpty,
  getTextContent,
  setTextSize,
  textLineHeightPx,
  textSizePx,
} from '../../shared/objects/text';
import {
  TEXT_BOX_PADDING_WORLD,
  TEXT_MAX_CHARS,
  type TextSize,
} from '../../shared/config';
import type { EndEditNext } from '../board/useSelection';
import type { ObjectProps } from './ObjectProps';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import { useTextBoxSync } from './useTextBoxSync';

export interface TextObjectProps extends ObjectProps {
  note: TextSnapshot;
}

export function TextObject({
  note,
  doc,
  zoom,
  selected,
  editing,
  dragging,
  canEdit = true,
  onSelect,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  undo,
}: TextObjectProps): JSX.Element {
  const ytext = useMemo(() => getTextContent(doc, note.id), [doc, note.id]);
  // This screen owns the box of text it changed (design key decision 1).
  const boxes = useTextBoxSync(doc, note.id);

  const fontPx = textSizePx(note.size);
  const lineWorld = textLineHeightPx(note.size);
  const areaRef = useRef<HTMLDivElement | null>(null);

  /**
   * If the words this screen drew do not fit the box it was given, the box grows to hold them.
   *
   * The box is measured, not drawn, and a browser is the only one that knows how the words really
   * wrap: its fonts may differ from the screen that measured, and characters two people type into
   * one text merge into a shape neither of them measured. So the shortfall is checked where it can
   * be seen, and `growToFit` can only ever make the box bigger, which is why five screens doing
   * this at once still agree.
   *
   * The height is rounded up to whole lines, because a box of a text object is always a whole number
   * of lines and a fractional one would disagree with the next measurement.
   */
  const checkItFits = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    if (area.scrollHeight <= area.clientHeight + 1) return; // it fits: nothing to say
    const scale = zoom > 0 ? 1 / zoom : 1;
    const lines = lineWorld > 0 ? Math.ceil((area.scrollHeight * scale) / lineWorld) : 1;
    boxes.growToFit({ width: area.scrollWidth * scale, height: Math.max(1, lines) * lineWorld });
  }, [boxes, lineWorld, zoom]);

  useEffect(() => {
    // while editing, the box follows the typing from the inside, and the field scrolls meanwhile
    if (editing) return;
    checkItFits();

    // a webfont that arrives after the first paint rewraps the words, with nothing else happening
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (!fonts) return;
    let here = true;
    void fonts.ready
      .then(() => {
        if (here) checkItFits();
      })
      .catch(() => {
        /* a board that cannot tell about its fonts draws with what it has */
      });
    return () => {
      here = false;
    };
  }, [editing, checkItFits, note.text, note.size, note.width, note.height, note.widthMode]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // the size toolbar handles its own clicks
    if (target?.closest('[data-text-toolbar]')) return;
    // stop propagation so the board viewport doesn't pan
    event.stopPropagation();
    if (editing) return; // typing is the textarea's business

    onObjectPointerDown(event, note.id);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // the board must not place another object on top of this one
    event.stopPropagation();
    event.preventDefault();
    if (editing) return;
    onSelect(note.id);
    // no editing on a board that could not be loaded (story 4)
    if (!canEdit) return;
    onStartEdit(note.id);
  };

  /**
   * Ending an edit. Text with no characters in it is removed here, in the same capture window as
   * the typing that got it there, so one undo brings the text back whole (design key decision 3).
   * A note is kept when emptied; text is not, because an empty note is still a coloured square
   * while empty text is an invisible target.
   */
  const handleEndEdit = (next: EndEditNext) => {
    if (deleteIfEmpty(doc, note.id)) {
      onEndEdit('unselected');
      return;
    }
    onEndEdit(next);
  };

  const style = {
    left: note.x,
    top: note.y,
    width: note.width,
    height: note.height,
    zIndex: note.z,
    '--text-font-size': `${fontPx}px`,
    '--text-padding': `${TEXT_BOX_PADDING_WORLD}px`,
    '--text-inverse-zoom': zoom > 0 ? String(1 / zoom) : '1',
  } as CSSProperties;

  return (
    <div
      className="board-text"
      data-board-object
      data-text-object
      data-text-id={note.id}
      data-size={note.size}
      data-width-mode={note.widthMode}
      data-selected={selected ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      data-testid="text-object"
      role="group"
      aria-label="Text"
      tabIndex={0}
      style={style}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          onEnd={handleEndEdit}
          undo={undo}
          className="board-text__input"
          testId="text-object-input"
          ariaLabel="Text"
        />
      ) : (
        <div
          ref={areaRef}
          className="board-text__content"
          data-testid="text-object-text"
          style={{ fontSize: `${fontPx}px` }}
        >
          {note.text}
        </div>
      )}
      {selected && !editing && !dragging ? (
        <TextToolbar
          size={note.size}
          canEdit={canEdit}
          onSize={(size: TextSize) => {
            if (!canEdit) return;
            // one size change is one step, and the box that follows it belongs to the same step
            undo?.boundary();
            setTextSize(doc, note.id, size);
            undo?.boundary();
          }}
          onDelete={() => {
            if (!canEdit) return;
            undo?.boundary();
            deleteObject(doc, note.id);
            undo?.boundary();
            onEndEdit('unselected');
          }}
        />
      ) : null}
    </div>
  );
}
