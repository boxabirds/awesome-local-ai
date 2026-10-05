/**
 * TextObject: renders and edits text objects on the board (story 9).
 */
import { useEffect, useRef } from 'react';
import { getTextContent, deleteIfEmpty, type TextSnapshot } from '../../shared/objects/text';
import { TEXT_SIZES, TEXT_FONT_FAMILY, TEXT_MAX_CHARS } from '../../shared/config';
import { TextEditor } from './TextEditor';
import { createCanvasMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import type { EndEditTarget } from '../board/useSelection';
import type { ObjectComponentProps } from './registry';

/** Shared measurer instance (created once per module). */
let sharedMeasurer: ReturnType<typeof createCanvasMeasurer> | null = null;
function getMeasurer() {
  if (!sharedMeasurer) sharedMeasurer = createCanvasMeasurer();
  return sharedMeasurer;
}

export interface TextObjectProps extends ObjectComponentProps {
  snapshot: TextSnapshot;
}

/**
 * Renders a text object on the board.
 *
 * Plain text, no fill, at x/y with stored width/height, white-space: pre-wrap,
 * font-size from TEXT_SIZES[size]. Double-click or Enter starts editing.
 */
export function TextObjectComponent(props: ObjectComponentProps) {
  const { doc, snapshot, selection, onEditChange, onObjectPointerDown } = props;
  const textSnap = snapshot as TextSnapshot;
  const ref = useRef<HTMLDivElement>(null);
  const editing = selection.editing;

  // Click outside ends editing.
  useEffect(() => {
    if (!editing) return;
    const onDocPointerDown = (event: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      if (event.target instanceof Node && !el.contains(event.target)) {
        endEditing('unselected');
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
  }, [editing, onEditChange, snapshot.id]);

  const endEditing = (next: EndEditTarget) => {
    // Delete if empty (zero characters).
    deleteIfEmpty(doc, snapshot.id);
    onEditChange(snapshot.id, next);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onEditChange(snapshot.id, null);
  };

  const ytext = editing ? getTextContent(doc, snapshot.id) : undefined;
  const fontPx = TEXT_SIZES[textSnap.size];
  const measurer = getMeasurer();
  const boxSync = useTextBoxSync(doc, snapshot.id, measurer);

  const width = snapshot.width ?? TEXT_SIZES.M;
  const height = snapshot.height ?? Math.round(fontPx * 1.3);

  const textStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${snapshot.x}px`,
    top: `${snapshot.y}px`,
    width: `${width}px`,
    minHeight: `${height}px`,
    fontSize: `${fontPx}px`,
    fontFamily: TEXT_FONT_FAMILY,
    lineHeight: 1.3,
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    zIndex: snapshot.z,
    pointerEvents: 'auto',
    cursor: 'default',
    userSelect: editing ? 'text' : 'none',
  };

  return (
    <div
      ref={ref}
      className="text-object"
      data-object-body=""
      data-text-object=""
      data-object-id={snapshot.id}
      data-text-id={snapshot.id}
      data-selected={selection.selected ? 'true' : 'false'}
      data-dragging={selection.dragging ? 'true' : 'false'}
      role="group"
      aria-label={textSnap.text || 'Empty text'}
      tabIndex={0}
      style={textStyle}
      onPointerDown={(e) => {
        if (!editing) onObjectPointerDown(e, snapshot);
      }}
      onDoubleClick={onDoubleClick}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={textSnap.widthMode === 'fixed' ? width : 'auto'}
          onInput={() => boxSync.remeasureAfterLocalChange()}
          onEnd={(next) => endEditing(next)}
          ariaLabel="Text object"
        />
      ) : (
        <div
          className="text-object-content"
          data-text-content=""
          style={{
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
            minHeight: `${fontPx * 1.3}px`,
          }}
        >
          {textSnap.text}
        </div>
      )}
    </div>
  );
}
