// Active tool: return-to-Select behaviour (story 10, TC-22).
// S then create, L then create → Select active; S then Escape, L then Escape
// → Select active and nothing created.

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShape } from '../../src/shared/objects/shape';
import {
  dispatch,
  installResizeObserverMock,
  pointerEvent,
  renderApp,
  windowKey,
} from './helpers';
import { boardDoc, liveNotes } from './story7-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
});

const selectBtn = (): HTMLButtonElement => {
  const el = document.querySelector<HTMLButtonElement>('button[aria-label="Select (V)"]');
  if (el === null) throw new Error('Select (V) button not rendered');
  return el;
};

function shapeAt(x: number, y: number, w = 200, h = 100): string {
  const id = createShape(boardDoc(), { kind: 'rect', rect: { x, y, width: w, height: h }, at: { x, y } }, 'test');
  if (id === null) throw new Error('createShape failed');
  return id;
}

describe('tools.active_tool', () => {
  it('TC-22 S then create, L then create → Select active; S/L then Escape → Select, nothing created', async () => {
    const { container } = await renderApp();

    // S then create → Select active, one shape.
    windowKey('s');
    const shapeOverlay = container.querySelector<HTMLElement>('[data-testid="shape-tool"]');
    if (shapeOverlay === null) throw new Error('shape tool overlay not rendered');
    dispatch(shapeOverlay, pointerEvent('pointerdown', 640, 400));
    dispatch(shapeOverlay, pointerEvent('pointerup', 640, 400));
    expect(liveNotes().filter((n) => n.type === 'shape')).toHaveLength(1);
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');

    // L then create (drag A→B) → Select active, one connector.
    const a = shapeAt(100, 100);
    shapeAt(500, 100); // B fixture (connector target)
    windowKey('l');
    const connOverlay = container.querySelector<HTMLElement>('[data-testid="connector-tool"]');
    if (connOverlay === null) throw new Error('connector tool overlay not rendered');
    dispatch(connOverlay, pointerEvent('pointerdown', 840, 550)); // A centre
    dispatch(connOverlay, pointerEvent('pointermove', 1140, 550)); // B left-mid
    dispatch(connOverlay, pointerEvent('pointerup', 1140, 550));
    expect(liveNotes().filter((n) => n.type === 'connector')).toHaveLength(1);
    expect(liveNotes().filter((n) => n.type === 'connector')[0]!.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');

    // Baseline: 3 shapes (1 via tool + 2 fixtures), 1 connector.
    const shapesBefore = liveNotes().filter((n) => n.type === 'shape').length;
    const connectorsBefore = liveNotes().filter((n) => n.type === 'connector').length;
    expect(shapesBefore).toBe(3);
    expect(connectorsBefore).toBe(1);

    // S then Escape → Select active, nothing created.
    windowKey('s');
    windowKey('Escape');
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
    expect(liveNotes().filter((n) => n.type === 'shape')).toHaveLength(shapesBefore);
    expect(liveNotes().filter((n) => n.type === 'connector')).toHaveLength(connectorsBefore);

    // L then Escape → Select active, no new connector.
    windowKey('l');
    windowKey('Escape');
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
    expect(liveNotes().filter((n) => n.type === 'shape')).toHaveLength(shapesBefore);
    expect(liveNotes().filter((n) => n.type === 'connector')).toHaveLength(connectorsBefore);
  });
});
