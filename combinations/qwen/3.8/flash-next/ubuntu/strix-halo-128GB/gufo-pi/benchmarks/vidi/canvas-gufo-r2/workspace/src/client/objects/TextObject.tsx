/**
 * Text object rendering and editing (story 9).
 *
 * Plain text, no fill/border/shadow. Stored width/height from the doc.
 * Double-click or Enter (single selection) starts editing.
 * Edit end calls deleteIfEmpty; empty text is removed.
 */
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import * as Y from 'yjs';
import { TEXT_SIZES, TEXT_MAX_CHARS, type TextSize } from '../../shared/config';
import { deleteIfEmpty } from '../../shared/objects/text';
import { createCanvasMeasurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

export function TextObject(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, readOnly = false } = props;
  const objId = obj.id;

  const size = (obj.size as TextSize) ?? 'M';
  const fontPx = TEXT_SIZES[size];
  const width = obj.width ?? 100;
  const height = obj.height ?? fontPx * 1.3;
  const widthMode = obj.widthMode ?? 'auto';

  // Stable measurer per component instance
  const measure = useMemo(() => createCanvasMeasurer(), []);

  const { remeasureAfterLocalChange } = useTextBoxSync(doc, objId, measure);

  // Remeasure when widthMode transitions to 'fixed' (resize gesture) or width changes
  // while already in fixed mode. In auto mode the content determines width.
  const prevStateRef = useRef({ width, widthMode });
  useEffect(() => {
    const prev = prevStateRef.current;
    const modeChangedToFixed = widthMode === 'fixed' && prev.widthMode !== 'fixed';
    const widthChangedInFixed = widthMode === 'fixed' && prev.widthMode === 'fixed' && prev.width !== width;
    prevStateRef.current = { width, widthMode };
    if (!modeChangedToFixed && !widthChangedInFixed) return;
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const ytext = objects.get(objId)?.get('text') as Y.Text | undefined;
    if (ytext && ytext.toString().length > 0) {
      remeasureAfterLocalChange();
    }
  }, [width, widthMode, remeasureAfterLocalChange, doc, objId]);

  const handleInput = useCallback(() => {
    remeasureAfterLocalChange();
  }, [remeasureAfterLocalChange]);

  const handleEndEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      // Delete if empty (story 9: empty text is removed)
      const deleted = deleteIfEmpty(doc, objId);
      if (deleted) {
        // Object was removed; tell selection to clear
        props.onEndEdit('unselected');
      } else {
        props.onEndEdit(next);
      }
    },
    [doc, objId, props],
  );

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${obj.x}px`,
    top: `${obj.y}px`,
    width: `${width}px`,
    minHeight: `${height}px`,
    zIndex: obj.z,
    pointerEvents: 'auto',
    touchAction: 'none',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: `${fontPx}px`,
    lineHeight: 1.3,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    cursor: readOnly ? 'default' : undefined,
    outline: selected ? '2px solid #4A90D9' : 'none',
    outlineOffset: 2,
  };

  // Get Y.Text for the editor
  const ytext = editing
    ? (doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>).get(objId)?.get('text') as Y.Text | undefined
    : undefined;

  return (
    <div
      className={`text-object${selected ? ' text-selected' : ''}`}
      role="group"
      aria-label={obj.text || 'Text'}
      data-text-id={objId}
      data-selected={selected ? 'true' : undefined}
      data-editing={editing ? 'true' : undefined}
      tabIndex={0}
      style={style}
      onPointerDown={(e) => {
        if (editing) return;
        props.onObjectPointerDown(e, objId);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (readOnly) return;
        props.onStartEdit(objId);
      }}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={widthMode === 'fixed' ? width : 'auto'}
          onInput={handleInput}
          onEnd={handleEndEdit}
          undo={props.undo}
        />
      ) : (
        <span className="text-object-content">{obj.text}</span>
      )}
    </div>
  );
}
