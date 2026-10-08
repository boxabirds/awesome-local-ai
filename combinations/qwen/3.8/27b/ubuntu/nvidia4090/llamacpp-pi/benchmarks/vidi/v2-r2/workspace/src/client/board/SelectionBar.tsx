/**
 * Selection bars (story 7 multi-selection, story 9 single text).
 *
 * - Exactly one selected TEXT object: a floating TextToolbar (S/M/L/XL +
 *   Delete) centred just above the object.
 * - Two or more selected objects: a bar with "N selected" (announced
 *   through an aria-live="polite" region) and a Delete button
 *   (`aria-label="Delete selection"`) that deletes the whole selection.
 * - Exactly one selected sticky shows story 2's NoteToolbar instead
 *   (rendered by the board); one selected non-sticky, non-text object shows
 *   nothing (keyboard delete still works).
 */
import type { JSX } from 'react';
import { TEXT_SIZES, type TextSize } from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { TextToolbar } from '../objects/TextToolbar';

interface Props {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  /** The board camera (for placing the single-text toolbar in screen space). */
  camera: Camera;
  onDelete(): void;
  /** Change the size of the single selected text (story 9). */
  onTextSize(s: TextSize): void;
  /** load_failed: delete is disabled. */
  disabled?: boolean;
}

export function SelectionBar({
  ids,
  snapshot,
  camera,
  onDelete,
  onTextSize,
  disabled = false,
}: Props): JSX.Element | null {
  if (ids.size === 1) {
    const text = snapshot.find((o) => ids.has(o.id) && o.type === 'text');
    if (text === undefined) {
      return null; // single sticky: the NoteToolbar (board) shows instead
    }
    const width =
      typeof text.width === 'number' && text.width > 0
        ? text.width
        : TEXT_SIZES[text.size ?? 'M'];
    const pos = worldToScreen(camera, { x: text.x + width / 2, y: text.y });
    return (
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: `${pos.x}px`,
          top: `${pos.y - 10}px`,
          transform: 'translate(-50%, -100%)',
          zIndex: 2500,
        }}
      >
        <TextToolbar
          size={text.size ?? 'M'}
          onSize={onTextSize}
          onDelete={onDelete}
          disabled={disabled}
        />
      </div>
    );
  }

  if (ids.size < 2) {
    return null;
  }
  const present = snapshot.filter((o) => ids.has(o.id)).length;
  if (present === 0) {
    return null;
  }

  return (
    <div
      data-testid="selection-bar"
      aria-live="polite"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: '50%',
        top: 12,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 12px',
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #d8d8d0',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.16)',
        zIndex: 2500,
      }}
    >
      <span>{`${ids.size} selected`}</span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="selection-delete-button"
        onClick={onDelete}
        disabled={disabled}
        style={{
          padding: '4px 10px',
          background: '#f4f4f0',
          border: '1px solid #d8d8d0',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Delete
      </button>
    </div>
  );
}
