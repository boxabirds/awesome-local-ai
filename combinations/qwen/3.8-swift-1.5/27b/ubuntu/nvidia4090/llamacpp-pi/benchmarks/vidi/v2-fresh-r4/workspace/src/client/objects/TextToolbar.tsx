/**
 * Text toolbar (story 9): shown above a single selected text object.
 * Four size presets (S M L XL), Undo, Redo, and Delete.
 * Rendered in screen space (not scaled by zoom).
 */
import { useState, type JSX } from 'react';
import * as Y from 'yjs';
import type { TextSnapshot } from '../../shared/board-model';
import type { TextSize } from '../../shared/config';
import { setTextSize } from '../../shared/objects/text';

export interface TextToolbarProps {
  snap: TextSnapshot;
  doc: Y.Doc;
  onSize?: (id: string, size: TextSize) => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const SIZES: TextSize[] = ['S', 'M', 'L', 'XL'];

export function TextToolbar(props: TextToolbarProps): JSX.Element {
  const { snap, doc, onSize, onDelete, onUndo, onRedo } = props;
  // Local active state so the pressed state updates immediately on click
  const [active, setActive] = useState<TextSize>(snap.size);

  const stopPointer = (e: React.PointerEvent) => e.stopPropagation();
  const stopClick = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="text-toolbar"
      data-vidi6="text-toolbar"
      onPointerDown={stopPointer}
      onClick={stopClick}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          className={`text-toolbar-size${active === s ? ' text-toolbar-size--active' : ''}`}
          data-vidi6={`text-size-${s}`}
          aria-label={`Text size ${s}`}
          aria-pressed={active === s}
          onClick={() => {
            setActive(s);
            setTextSize(doc, snap.id, s);
            onSize?.(snap.id, s);
          }}
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        className="text-toolbar-undo"
        data-vidi6="text-undo"
        aria-label="Undo"
        onClick={onUndo}
        title="Undo"
      >
        ↶
      </button>
      <button
        type="button"
        className="text-toolbar-redo"
        data-vidi6="text-redo"
        aria-label="Redo"
        onClick={onRedo}
        title="Redo"
      >
        ↷
      </button>
      <button
        type="button"
        className="text-toolbar-delete"
        data-vidi6="text-delete"
        aria-label="Delete text"
        onClick={onDelete}
        title="Delete text"
      >
        🗑
      </button>
    </div>
  );
}
