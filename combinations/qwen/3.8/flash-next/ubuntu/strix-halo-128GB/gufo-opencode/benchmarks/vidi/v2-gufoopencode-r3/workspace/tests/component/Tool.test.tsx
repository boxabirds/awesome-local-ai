import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { screenToWorld } from '../../src/client/canvas/camera';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { initialCamera, windowSize } from './helpers';

// Mutable connection status holder drives the canEdit gate for TC-15 without
// a real provider (same technique as LoadFailure.test.tsx).
const holder = vi.hoisted(() => ({ status: 'connected' as string }));
vi.mock('../../src/client/sync/ConnectionStatus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/ConnectionStatus')>();
  return { ...actual, useConnectionStatus: () => holder.status as never };
});

const { BoardView } = await import('../../src/client/pages/BoardPage');

function mount(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  render(<BoardView doc={doc} />);
  return doc;
}

function objectsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('objects');
}

function textButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Text (T)' });
}

beforeEach(() => {
  vi.useFakeTimers();
  holder.status = 'connected';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('text.tool_ui', () => {
  it('TC-14 T activates the Text tool; Escape and V return to Select', () => {
    mount();
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.keyDown(window, { key: 'T' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Select (V)' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.keyDown(window, { key: 'T' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'V' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-15 on a load-failed board the Text button is disabled and T is ignored', () => {
    holder.status = 'load_failed';
    const doc = mount();
    const button = textButton();
    expect(button).toBeDisabled();

    fireEvent.keyDown(window, { key: 'T' });
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(objectsOf(doc).size).toBe(0);
  });

  it('TC-16 pressing T while editing a sticky types the character and does not switch tools', () => {
    const doc = mount();
    act(() => {
      createSticky(doc, { x: 0, y: 0 });
    });
    const note = screen.getAllByTestId('sticky-note')[0];
    fireEvent.pointerDown(note, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerUp(note, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.doubleClick(note);
    const textarea = screen.getByTestId('sticky-textarea');

    fireEvent.keyDown(textarea, { key: 't' });
    fireEvent.input(textarea, { target: { value: 't' } });

    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(snapshot(doc)[0].text).toBe('t');
  });

  it('TC-17 Text active: clicking the board creates text at the world point and starts editing', () => {
    const doc = mount();
    fireEvent.keyDown(window, { key: 'T' });
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { clientX: 300, clientY: 200, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 200, pointerId: 1 });

    const objects = [...objectsOf(doc).values()];
    expect(objects).toHaveLength(1);
    const cam = initialCamera();
    const world = screenToWorld(cam, { x: 300, y: 200 });
    expect(objects[0].get('type')).toBe('text');
    expect(objects[0].get('x')).toBeCloseTo(world.x, 6);
    expect(objects[0].get('y')).toBeCloseTo(world.y, 6);
    expect(objects[0].get('size')).toBe('M');

    // Tool is back to Select and the editor for the new text is mounted.
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('text-editor')).toBeInTheDocument();
  });

  it('TC-18 N still creates a sticky note at the view centre (story 2 regression)', () => {
    const doc = mount();
    fireEvent.keyDown(window, { key: 'N' });

    const snaps = snapshot(doc);
    expect(snaps).toHaveLength(1);
    const { width, height } = windowSize();
    const cam = initialCamera();
    // createSticky centres the note on the view centre.
    expect(snaps[0].x).toBeCloseTo(width / 2 + cam.x - 100, 6);
    expect(snaps[0].y).toBeCloseTo(height / 2 + cam.y - 100, 6);
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
    // N does not touch the tool.
    expect(textButton()).toHaveAttribute('aria-pressed', 'false');
  });
});
