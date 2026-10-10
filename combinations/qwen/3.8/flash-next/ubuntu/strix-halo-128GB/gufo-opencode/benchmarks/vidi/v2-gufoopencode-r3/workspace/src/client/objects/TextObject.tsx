import { useMemo, type JSX } from 'react';
import { objectBounds } from '../../shared/board-model';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_SIZES
} from '../../shared/config';
import { deleteIfEmpty, getTextContent, getTextFields } from '../../shared/objects/text';
import { createCanvasMeasurer } from './textLayout';
import { TextEditor } from './TextEditor';
import { useTextBoxSync } from './useTextBoxSync';
import type { EndEditNext } from './StickyText';
import type { ObjectProps } from './registry';

export type TextObjectProps = ObjectProps;

// Plain text floating on the board: no fill, top-left anchored at x/y, the
// stored width/height box (kept in sync locally by useTextBoxSync). Selection,
// move, delete and undo are generic (registry); height is derived, so only
// horizontal handles are offered (see SelectionOverlay).
export function TextObject(props: TextObjectProps): JSX.Element {
  const {
    obj,
    doc,
    selected,
    editing,
    editable = true,
    onObjectPointerDown,
    onStartEdit,
    onEndEdit,
    undo
  } = props;
  const measure = useMemo(() => createCanvasMeasurer(), []);
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, obj.id, measure);

  const fields = getTextFields(doc, obj.id);
  const size = fields?.size ?? DEFAULT_TEXT_SIZE;
  const fontPx = TEXT_SIZES[size];
  const text = fields?.text ?? '';
  const bounds = objectBounds(obj);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Pressing text must never pan the board underneath it.
    e.stopPropagation();
    if (!editable) return; // load-failed board: no interaction (TC-23)
    if (editing) return; // the textarea owns interaction while editing
    onObjectPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editable) return; // load-failed board: no edit (TC-23)
    if (!editing) onStartEdit(obj.id);
  };

  const ytext = editing ? getTextContent(doc, obj.id) : undefined;
  const showEditor = editing && ytext !== undefined;

  // Ends editing and drops never-used text. deleteIfEmpty runs before the
  // editor's unmount undo boundary, so an abandoned text shares one undo
  // step with the click that placed it (design key decision 3).
  const endEdit = (next: EndEditNext) => {
    const removed = deleteIfEmpty(doc, obj.id);
    onEndEdit(removed ? 'unselected' : next);
  };

  return (
    <div
      data-testid="text-object"
      data-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label="Text"
      tabIndex={0}
      className="text-object"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: fontPx,
        lineHeight: String(TEXT_LINE_HEIGHT)
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {showEditor ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={fields?.widthMode === 'fixed' ? bounds.width : 'auto'}
          onInput={remeasureAfterLocalChange}
          onEnd={endEdit}
          undo={undo}
          testId="text-editor"
          className="text-textarea"
        />
      ) : (
        text
      )}
    </div>
  );
}
