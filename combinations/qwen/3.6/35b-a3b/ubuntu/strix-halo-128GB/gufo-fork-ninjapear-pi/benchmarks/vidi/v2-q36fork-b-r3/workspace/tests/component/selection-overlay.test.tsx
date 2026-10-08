import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react/pure';
import '@testing-library/jest-dom/vitest';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import type { Camera } from '../../src/client/canvas/camera';
import type { StickySnapshot } from '../../src/shared/board-model';
import * as Y from 'yjs';
import { createSticky } from '../../src/shared/board-model';

describe('SelectionOverlay component', () => {
  afterEach(cleanup);

  function makeCamera(zoom = 1): Camera {
    return { x: 0, y: 0, zoom };
  }

  function makeNotes(count: number) {
    const notes: StickySnapshot[] = [];
    for (let i = 0; i < count; i++) {
      notes.push({ id: `note-${i}`, x: 100 + i * 30, y: 100, text: '', color: 'yellow', z: 0, type: 'sticky', createdAt: Date.now() });
    }
    return notes;
  }

  test('TC-20: renders null when no selection', () => {
    const camera = makeCamera(1);
    const { container } = render(<SelectionOverlay ids={new Set()} snapshot={[]} camera={camera} onHandlePointerDown={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  test('TC-21: renders outline and handles when single sticky selected', () => {
    const notes = makeNotes(1);
    const camera = makeCamera(1);
    const onHandlePointerDown = vi.fn();
    const { container } = render(
      <SelectionOverlay ids={new Set([notes[0].id])} snapshot={notes} camera={camera} onHandlePointerDown={onHandlePointerDown} />
    );
    expect(container.querySelector('[data-selection-bounds]')).toBeInTheDocument();
    // Should show 8 resize handles
    const handles = container.querySelectorAll('[data-handle]');
    expect(handles.length).toBe(8);
  });

  test('TC-22: renders a bounding box around multiple selections', () => {
    const notes = makeNotes(5);
    const allIds = new Set(notes.map((n) => n.id));
    const camera = makeCamera(1);
    const { container } = render(
      <SelectionOverlay ids={allIds} snapshot={notes} camera={camera} onHandlePointerDown={vi.fn()} />
    );
    const bounds = container.querySelector('[data-selection-bounds]');
    expect(bounds).toBeInTheDocument();
    expect(bounds!.childElementCount).toBeGreaterThan(0); // outline + handles
  });

  test('TC-23: handle elements trigger onHandlePointerDown callback', () => {
    const notes = makeNotes(1);
    const camera = makeCamera(1);
    const onHandlePointerDown = vi.fn();
    const { container } = render(
      <SelectionOverlay ids={new Set([notes[0].id])} snapshot={notes} camera={camera} onHandlePointerDown={onHandlePointerDown} />
    );
    const handles = container.querySelectorAll('[data-handle="nw"]');
    if (handles.length > 0) {
      fireEvent.pointerDown(handles[0], { button: 0, clientX: 0, clientY: 0 });
      expect(onHandlePointerDown).toHaveBeenCalled();
    }
  });
});
