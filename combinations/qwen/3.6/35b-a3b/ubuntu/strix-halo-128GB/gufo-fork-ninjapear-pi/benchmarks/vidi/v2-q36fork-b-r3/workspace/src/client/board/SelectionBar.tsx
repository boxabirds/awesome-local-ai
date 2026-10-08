import React from 'react';
import * as Y from 'yjs';
import type { ObjectSnap } from '@shared/board-model';
import type { TextSnapshot } from '@shared/objects/text';
import type { StickyColor, TextSize } from '@shared/config';
import { setStickyColor, deleteObjects } from '@shared/board-model';

export type SnapshotWithText = ObjectSnap | TextSnapshot;

interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly SnapshotWithText[];
  doc: Y.Doc;
  onDelete(): void;
  onBoundary?(): void;
  onSizeChange?(id: string, size: string): void;
}

export function SelectionBar({ ids, snapshot, doc, onDelete, onBoundary, onSizeChange }: SelectionBarProps) {
  const count = ids.size;
  if (count === 0) return null;

  // Exactly one object → show type-specific toolbar
  if (count === 1) {
    const note = snapshot.find((s) => s.id === [...ids][0]);
    if (!note) return null;

    // Single sticky → show colour bar
    if (note.type === 'sticky') {
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
                onBoundary?.();
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
              onBoundary?.();
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

    // Single text → show size toolbar
    if (note.type === 'text') {
      return (
        <TextToolbar
          size={note.size}
          onSize={(size) => {
            onBoundary?.();
            onSizeChange?.(note.id, size);
          }}
          onDelete={() => {
            onBoundary?.();
            onDelete();
          }}
        />
      );
    }
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
          onBoundary?.();
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

// Simple inline TextToolbar for multi-object selection
function TextToolbar({ size, onSize, onDelete }: {
  size: string;
  onSize(size: string): void;
  onDelete(): void;
}) {
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
      {(['S', 'M', 'L', 'XL'] as const).map((s) => (
        <button
          key={s}
          aria-label={`Text size ${s}`}
          aria-pressed={size === s}
          onClick={(e) => {
            e.stopPropagation();
            onSize(s);
          }}
          style={{
            minWidth: 20,
            height: 20,
            border: size === s ? '2px solid #333' : '1px solid rgba(0,0,0,0.2)',
            borderRadius: 4,
            background: '#f0f0f0',
            cursor: 'pointer',
            padding: 0,
            fontSize: s === 'XL' ? 10 : 11,
            fontWeight: size === s ? 700 : 400,
          }}
        >
          {s}
        </button>
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
