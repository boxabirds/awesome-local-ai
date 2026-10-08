import React from 'react';
import * as Y from 'yjs';
import { StickySnapshot } from '@shared/board-model';
import type { StickyColor } from '@shared/config';
import { setStickyColor, deleteObjects } from '@shared/board-model';
import { NoteToolbar } from '../objects/NoteToolbar';
import type { StickyColor as ColorType } from '@shared/config';

interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly StickySnapshot[];
  doc: Y.Doc;
  onDelete(): void;
}

export function SelectionBar({ ids, snapshot, doc, onDelete }: SelectionBarProps) {
  const count = ids.size;
  if (count === 0) return null;

  // Exactly one sticky → show NoteToolbar instead
  if (count === 1) {
    const note = snapshot.find((s) => s.id === [...ids][0]);
    if (!note || note.type !== 'sticky') return null;
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          gap: 4,
          alignItems: 'center',
          padding: '4px 6px',
          borderRadius: 16,
          background: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          zIndex: 90,
        }}
      >
        {Object.entries({
          yellow: '#FFF59D',
          orange: '#FFCC80',
          green: '#C5E1A5',
          blue: '#90CAF9',
          pink: '#F48FB1',
          violet: '#CE93D8',
        }).map(([name, hex]) => (
          <button
            key={name}
            aria-label={`${name} colour`}
            aria-pressed={note.color === name}
            title={`${name} colour`}
            onClick={(e) => {
              e.stopPropagation();
              setStickyColor(doc, note!.id, name as StickyColor);
            }}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: hex,
              border: note.color === name ? '2px solid #333' : '1px solid rgba(0,0,0,0.2)',
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
        <div
          style={{
            width: 1,
            height: 20,
            background: '#ddd',
            margin: '0 2px',
          }}
        />
        <button
          aria-label="Delete note"
          title="Delete note"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{
            width: 20,
            height: 20,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            color: '#c44',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          🗑
        </button>
      </div>
    );
  }

  // Two or more selected → group selection bar
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${count} selected`}
      data-selection-bar
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 12px',
        borderRadius: 8,
        background: '#2196F3',
        color: '#fff',
        fontSize: 14,
        fontWeight: 500,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: 90,
        userSelect: 'none',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span>{count} selected</span>
      <button
        aria-label="Delete selection"
        title="Delete selection"
        onClick={(e) => {
          e.stopPropagation();
          const idList = [...ids];
          deleteObjects(doc, idList);
          onDelete();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(255,255,255,0.2)',
          border: 'none',
          borderRadius: 4,
          color: '#fff',
          cursor: 'pointer',
          padding: '4px 8px',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        🗑 Delete
      </button>
    </div>
  );
}
