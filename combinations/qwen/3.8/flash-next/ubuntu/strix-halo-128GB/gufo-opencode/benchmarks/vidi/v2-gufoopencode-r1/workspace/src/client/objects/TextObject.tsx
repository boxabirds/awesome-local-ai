import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, JSX } from 'react';
import { deleteObject, isTextObject, LOCAL_ORIGIN } from '../../shared/board-model';
import { DEFAULT_TEXT_SIZE, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../shared/config';
import { deleteIfEmpty, getTextContent, setTextSize } from '../../shared/objects/text';
import { useUndoController } from '../board/useUndo';
import { SELECTION_OUTLINE_COLOR } from './stickyStyles';
import { createCanvasMeasurer, TEXT_BOX_PADDING_WORLD } from './textLayout';
import { remeasureText, useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import type { ObjectProps } from './registry';

// Story 9 renderer (design text.render): plain text on the board, no frame.
// Box size is layout-driven (useTextBoxSync); the toolbar changes size and the
// horizontal handles set a fixed width — both remeasure locally. Ending
// editing with an empty string deletes the object.
export function TextObject(props: ObjectProps): JSX.Element {
  const { obj, doc, zoom, selected, dragging, editing, editable } = props;
  const undo = useUndoController();
  const measure = useMemo(() => createCanvasMeasurer(), []);
  useTextBoxSync(doc, obj.id, measure);

  const text = isTextObject(obj) ? obj.text : '';
  const size = isTextObject(obj) ? obj.size : DEFAULT_TEXT_SIZE;
  const fontPx = TEXT_SIZES[size];

  // Empty text is thrown away when editing ends, whoever ended it (Escape,
  // click-away, or the object losing selection some other way).
  const prevEditing = useRef(editing);
  useEffect(() => {
    if (prevEditing.current && !editing) deleteIfEmpty(doc, obj.id);
    prevEditing.current = editing;
  }, [editing, doc, obj.id]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (editing) {
      event.stopPropagation();
      return;
    }
    props.onObjectPointerDown(event, obj.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    if (!editable || editing) return;
    props.onStartEdit(obj.id);
  };

  const rootStyle: CSSProperties = {
    position: 'absolute',
    left: obj.x,
    top: obj.y,
    width: obj.width,
    height: obj.height,
    boxSizing: 'border-box',
    padding: TEXT_BOX_PADDING_WORLD / 2,
    fontFamily: TEXT_FONT_FAMILY,
    fontSize: fontPx,
    lineHeight: String(TEXT_LINE_HEIGHT),
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    color: '#1f2937',
    background: 'transparent',
    pointerEvents: 'auto',
    outline: selected ? `1px solid ${SELECTION_OUTLINE_COLOR}` : 'none',
    outlineOffset: 1,
    zIndex: obj.z,
    cursor: dragging ? 'grabbing' : 'grab',
    userSelect: editing ? 'text' : 'none'
  };

  const ytext = editing ? getTextContent(doc, obj.id) : undefined;

  return (
    <div
      role="group"
      aria-label="Text"
      data-testid={`text-${obj.id}`}
      data-selected={selected}
      data-dragging={dragging}
      style={rootStyle}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {editing && ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={obj.width}
          testId={`text-editor-${obj.id}`}
          onCommit={() => remeasureText(doc, obj.id, measure)}
          onEnd={props.onEndEdit}
        />
      ) : (
        <div data-testid={`text-content-${obj.id}`} style={{ width: '100%', height: '100%' }}>
          {text}
        </div>
      )}
      {editable && selected && !editing && !dragging ? (
        <div
          data-testid={`text-toolbar-anchor-${obj.id}`}
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            height: 0,
            transform: `scale(${1 / (zoom || 1)})`,
            transformOrigin: 'bottom left',
            pointerEvents: 'none'
          }}
        >
          <TextToolbar
            size={size}
            onSize={(next) => {
              undo?.boundary();
              doc.transact(() => {
                if (setTextSize(doc, obj.id, next)) remeasureText(doc, obj.id, measure);
              }, LOCAL_ORIGIN);
              undo?.boundary();
            }}
            onDelete={() => {
              undo?.boundary();
              deleteObject(doc, obj.id);
              undo?.boundary();
              props.onEndEdit('unselected');
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
