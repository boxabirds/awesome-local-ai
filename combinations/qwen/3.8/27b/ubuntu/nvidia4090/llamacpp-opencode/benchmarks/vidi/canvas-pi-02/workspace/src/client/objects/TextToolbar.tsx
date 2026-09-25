/**
 * Text toolbar (story 9): shown in the SelectionBar when a single text
 * object is selected. Provides size buttons (S/M/L/XL) and a width input
 * for fixed-width mode.
 */

import { useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZES,
  TEXT_MIN_WIDTH_WORLD,
  type TextSize,
} from '../../shared/config';
import { setTextSize, setTextWidthFixed } from '../../shared/objects/text';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';

const SIZE_ORDER: TextSize[] = ['S', 'M', 'L', 'XL'];

export interface TextToolbarProps {
  doc: Y.Doc;
  obj: ObjectSnapshot;
  editable: boolean;
  boundary?: () => void;
}

export function TextToolbar({ doc, obj, editable, boundary }: TextToolbarProps): JSX.Element {
  const size: TextSize = obj.size ?? DEFAULT_TEXT_SIZE;
  const widthMode: 'auto' | 'fixed' = obj.widthMode ?? 'auto';
  const [widthInput, setWidthInput] = useState(
    widthMode === 'fixed' ? String(obj.width ?? '') : '',
  );

  const handleSize = (s: TextSize): void => {
    if (!editable || s === size) return;
    boundary?.();
    setTextSize(doc, LOCAL_ORIGIN, obj.id, s);
    boundary?.();
  };

  const handleWidthChange = (value: string): void => {
    setWidthInput(value);
  };

  const handleWidthCommit = (): void => {
    if (!editable) return;
    const w = parseFloat(widthInput);
    if (!Number.isFinite(w) || w < TEXT_MIN_WIDTH_WORLD) return;
    // Anchor: keep the left edge (for e handle) or compute from the current x.
    // When setting width via the toolbar, the anchor is the current x.
    const anchorX = obj.x;
    boundary?.();
    setTextWidthFixed(doc, LOCAL_ORIGIN, obj.id, w, anchorX);
    boundary?.();
  };

  return (
    <div className="vidi6-text-toolbar" data-testid="text-toolbar">
      {SIZE_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          className={`vidi6-text-toolbar__size${size === s ? ' vidi6-text-toolbar__size--active' : ''}`}
          aria-label={`Size ${s}`}
          aria-pressed={size === s}
          title={`Size ${s} (${TEXT_SIZES[s]}px)`}
          disabled={!editable}
          onClick={() => handleSize(s)}
        >
          {s}
        </button>
      ))}
      <span className="vidi6-text-toolbar__divider" aria-hidden="true" />
      <input
        type="number"
        className="vidi6-text-toolbar__width"
        aria-label="Width"
        title="Fixed width (world units)"
        min={TEXT_MIN_WIDTH_WORLD}
        placeholder={widthMode === 'fixed' ? String(obj.width ?? '') : 'auto'}
        value={widthInput}
        disabled={!editable}
        onChange={(e) => handleWidthChange(e.target.value)}
        onBlur={handleWidthCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleWidthCommit();
          }
        }}
      />
    </div>
  );
}
