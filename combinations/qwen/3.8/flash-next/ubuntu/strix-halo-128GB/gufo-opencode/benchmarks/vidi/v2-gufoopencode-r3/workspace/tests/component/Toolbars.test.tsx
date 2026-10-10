import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';
import { initialCamera, windowSize } from './helpers';

function mount(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  render(<App doc={doc} />);
  return doc;
}

function addNote(doc: Y.Doc): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x: 0, y: 0 });
  });
  return id;
}

function tapSelectNote(): void {
  const el = screen.getAllByTestId('sticky-note')[0];
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sticky.toolbars', () => {
  it('TC-27 Sticky note button creates a note at the viewport centre and edits it', () => {
    const doc = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    expect(snapshot(doc)).toHaveLength(1);
    const { width, height } = windowSize();
    const cam = initialCamera();
    // Viewport centre in world coordinates (zoom 1): (w/2, h/2) - (-cam.x, -cam.y)
    const expectedX = width / 2 + cam.x;
    const expectedY = height / 2 + cam.y;
    // createSticky centres the note on the given world point.
    expect(snapshot(doc)[0].x).toBeCloseTo(expectedX - 100, 6);
    expect(snapshot(doc)[0].y).toBeCloseTo(expectedY - 100, 6);
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
  });

  it('TC-28 colour swatch changes the note colour and keeps selection', () => {
    const doc = mount();
    const id = addNote(doc);
    tapSelectNote();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Violet colour' }));
    expect(snapshot(doc)[0]).toMatchObject({ id, color: 'violet' });
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    // jsdom serialises the hex colour to rgb() in the style attribute.
    expect(screen.getAllByTestId('sticky-note')[0]).toHaveStyle({
      background: STICKY_COLORS.violet
    });
  });

  it('TC-29 delete button removes the note and clears selection', () => {
    const doc = mount();
    const id = addNote(doc);
    tapSelectNote();
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
    void id;
  });
});
