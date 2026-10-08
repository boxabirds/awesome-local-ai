import React from 'react';
import type { ShapeKind } from '@shared/objects/shape';
import { SHAPE_KINDS } from '@shared/config';

interface ShapeToolbarProps {
  kind: ShapeKind;
  onKindChange(kind: ShapeKind): void;
}

/** Horizontal tool strip for shape kind selection. */
export function ShapeToolbar({ kind, onKindChange }: ShapeToolbarProps) {
  return (
    <div style={{ display: 'flex', gap: 2, padding: '2px 4px', background: '#f5f5f5', borderRadius: 4 }}>
      {(SHAPE_KINDS as readonly string[]).map((k) => (
        <button
          key={k}
          title={`Shape: ${k}`}
          onClick={() => onKindChange(k as ShapeKind)}
          style={{
            padding: '4px 8px',
            border: '1px solid #bbb',
            borderRadius: 3,
            background: kind === k ? '#e3f2fd' : undefined,
            fontWeight: kind === k ? 600 : 400,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {k === 'rect' ? '▭' : k === 'ellipse' ? '◯' : k.toUpperCase().slice(0, 3)}
        </button>
      ))}
    </div>
  );
}
