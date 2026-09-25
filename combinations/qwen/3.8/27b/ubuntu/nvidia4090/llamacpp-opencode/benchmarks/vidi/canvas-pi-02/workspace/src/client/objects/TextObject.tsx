/**
 * Free text object in the world layer (story 9).
 *
 * Renders plain text at a fixed position with a computed box (auto or fixed
 * width). Double-click starts editing. The box is kept in sync with the
 * content via useTextBoxSync (auto mode only).
 */

import { memo, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import * as Y from 'yjs';
import { TEXT_LINE_HEIGHT, TEXT_SIZES, type TextSize } from '../../shared/config';
import { getTextYText } from '../../shared/objects/text';
import type { ObjectProps, Measurer } from './registry';
import { TextEditor } from './TextEditor';
import { useTextBoxSync } from './useTextBoxSync';

export interface TextObjectProps extends ObjectProps {
  /** The text measurer (canvas or fallback). */
  measurer: Measurer;
}

const stopEvent = (e: { stopPropagation(): void }): void => {
  e.stopPropagation();
};

export const TextObject = memo(function TextObject(props: TextObjectProps): React.JSX.Element | null {
  const { obj, doc, selected, editing, editable, undo, onObjectPointerDown, onSelect, onStartEdit, onEndEdit, measurer } = props;
  const rootRef = useRef<HTMLDivElement>(null);

  const text = obj.text ?? '';
  const size: TextSize = obj.size ?? 'M';
  const widthMode: 'auto' | 'fixed' = obj.widthMode ?? 'auto';
  const fontPx = TEXT_SIZES[size];
  const width = obj.width ?? 0;
  const height = obj.height ?? 0;

  // Keep the box in sync with content/size in auto mode.
  useTextBoxSync(doc, obj.id, measurer, obj);

  // While editing, a pointerdown anywhere outside the text ends editing.
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: Event): void => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        onEndEdit();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, onEndEdit]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editing) return;
    onObjectPointerDown(e.nativeEvent, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    if (!editable) return;
    if (!editing) onStartEdit(obj.id);
  };

  const ytext = getTextYText(doc, obj.id);

  const rootClass = [
    'vidi6-text',
    selected ? 'vidi6-text--selected' : null,
  ]
    .filter(Boolean)
    .join(' ');

  const rootStyle: CSSProperties = {
    left: obj.x,
    top: obj.y,
    width: Math.max(width, 1),
    height: Math.max(height, 1),
    fontSize: `${fontPx}px`,
    lineHeight: TEXT_LINE_HEIGHT,
  };

  return (
    <div
      ref={rootRef}
      className={rootClass}
      role="group"
      aria-label="Text"
      tabIndex={0}
      data-text-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : undefined}
      style={rootStyle}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onFocus={() => {
        const el = rootRef.current;
        if (el !== null && !el.matches(':focus-visible')) return;
        if (!selected && !editing) onSelect(obj.id);
      }}
    >
      {editing && ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          fontPx={fontPx}
          lineHeight={TEXT_LINE_HEIGHT}
          onEnd={() => onEndEdit()}
          undo={undo}
        />
      ) : (
        <div className="vidi6-text__display" style={rootStyle}>
          {text}
        </div>
      )}
    </div>
  );
});
