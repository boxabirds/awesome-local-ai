import React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import type { TextSize } from '../../shared/config';
import { TextToolbar } from '../objects/TextToolbar';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  /** Camera used to float the text toolbar above its object. */
  camera?: Camera;
  /** Size preset chosen in the text toolbar (single text selection). */
  onTextSize?(id: string, size: TextSize): void;
}

const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * Contextual actions for the selection: the text toolbar when exactly one text
 * object is selected (story 9), "N selected" + Delete for a multi-selection.
 * Returns null for 0 selected, and for a single sticky note (whose NoteToolbar
 * lives on the note itself).
 */
export function SelectionBar({ ids, snapshot, onDelete, camera, onTextSize }: SelectionBarProps) {
  const count = ids.size;

  if (count === 1) {
    const obj = snapshot.find((o) => ids.has(o.id));
    if (!obj) return null;
    if (obj.type !== 'text') return null;
    const cam = camera ?? DEFAULT_CAMERA;
    const bounds = objectBounds(obj);
    const tl = worldToScreen(cam, { x: bounds.x, y: bounds.y });
    const size = (obj as { size?: TextSize }).size ?? 'M';
    return (
      <div
        data-editor-ui="true"
        data-testid="text-selection-bar"
        style={{
          position: 'fixed',
          left: tl.x + (bounds.width * cam.zoom) / 2,
          top: Math.max(4, tl.y - 8),
          transform: 'translate(-50%, -100%)',
          zIndex: 1001,
        }}
      >
        <TextToolbar
          size={size}
          onSize={(s) => onTextSize?.(obj.id, s)}
          onDelete={() => onDelete()}
        />
      </div>
    );
  }

  if (count < 2) return null;

  return (
    <div
      data-editor-ui="true"
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection actions"
      style={{
        position: 'fixed',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: '6px 12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        zIndex: 1000,
      }}
    >
      <span aria-live="polite" data-testid="selection-count">
        {count} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="delete-selection-button"
        onClick={onDelete}
        style={{
          width: 28,
          height: 28,
          padding: 0,
          border: 'none',
          borderRadius: 6,
          background: 'none',
          color: '#5f6368',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 4h10M6.5 4V2.8h3V4M4.4 4l.6 9.2h6L11.6 4M6.6 6.2v5M9.4 6.2v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
