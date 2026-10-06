/**
 * Active tool component tests (task 11, TC-22). A board that cannot be written to is covered in
 * BoardLoadFailure.test.tsx, where the lock itself is the subject.
 *
 * The tool is the board's mode: one key puts a tool up, the toolbar says which one is up, a tool that
 * has made its object hands over to Select with the new object selected, and Escape puts the tool down
 * having made nothing.
 */
import { screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, test } from 'vitest';
import { renderBoard, dispatchKey, runFrames } from './helpers';
import {
  isConnectorSnapshot,
  isShapeSnapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';

const pointer = (clientX: number, clientY: number, opts?: Record<string, unknown>) => ({
  pointerId: 7,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  ...opts,
});

function objects(): readonly ObjectSnapshot[] {
  return window.__vidi6?.getObjects() ?? [];
}

function surfaceOf(testId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

async function openBoard(): Promise<void> {
  renderBoard();
  await runFrames();
  window.__vidi6!.setCamera({ x: 0, y: 0, zoom: 1 });
  await runFrames();
  await runFrames();
}

/** Press a tool key and let the tool mount. */
async function press(key: string): Promise<void> {
  dispatchKey(window, { key });
  await runFrames();
}

async function drag(testId: string, from: [number, number], to: [number, number]): Promise<void> {
  const surface = surfaceOf(testId);
  if (!surface) throw new Error(`${testId} is not up`);
  fireEvent.pointerDown(surface, pointer(from[0], from[1]));
  fireEvent.pointerMove(surface, pointer(to[0], to[1]));
  await runFrames();
  fireEvent.pointerUp(surface, pointer(to[0], to[1]));
  await runFrames();
}

describe('the active tool (TC-22)', () => {
  test('TC-22 the toolbar says which tool is up, in both directions', async () => {
    await openBoard();
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Shape (S)')).toHaveAttribute('aria-pressed', 'false');
    expect(button('Connector (L)')).toHaveAttribute('aria-pressed', 'false');

    await press('s');
    expect(surfaceOf('shape-tool-surface')).not.toBeNull();
    expect(button('Shape (S)')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'false');

    // the kind menu is what decides what S means
    fireEvent.click(button('Shape kind'));
    await runFrames();
    expect(button('Shape kind')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Diamond' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Diamond' }));
    await runFrames();
    expect(surfaceOf('shape-tool-surface')).not.toBeNull();
    expect(button('Shape kind')).toHaveAttribute('aria-expanded', 'false');

    await press('l');
    expect(surfaceOf('connector-tool-surface')).not.toBeNull();
    expect(button('Connector (L)')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Shape (S)')).toHaveAttribute('aria-pressed', 'false');

    await press('v');
    expect(surfaceOf('shape-tool-surface')).toBeNull();
    expect(surfaceOf('connector-tool-surface')).toBeNull();
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-22 a tool that has made its object is put down, with the object selected', async () => {
    await openBoard();

    await press('s');
    await drag('shape-tool-surface', [200, 200], [420, 340]);
    const shapes = objects().filter(isShapeSnapshot);
    expect(shapes.length).toBe(1);
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(
      document.querySelector(`[data-shape-id="${shapes[0]!.id}"]`),
    ).toHaveAttribute('data-selected', 'true');

    await press('l');
    await drag('connector-tool-surface', [200, 400], [700, 400]);
    const arrows = objects().filter(isConnectorSnapshot);
    expect(arrows.length).toBe(1);
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(
      document.querySelector(`[data-connector-id="${arrows[0]!.id}"]`),
    ).toHaveAttribute('data-selected', 'true');
  });

  test('TC-22 the kind the menu chose is the kind the key draws', async () => {
    await openBoard();

    await press('s');
    fireEvent.click(button('Shape kind'));
    await runFrames();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ellipse' }));
    await runFrames();
    await drag('shape-tool-surface', [100, 100], [300, 260]);

    const shapes = objects().filter(isShapeSnapshot);
    expect(shapes.length).toBe(1);
    expect(shapes[0]?.kind).toBe('ellipse');

    // and S now means ellipse, until the menu is told otherwise
    await press('s');
    await drag('shape-tool-surface', [500, 100], [700, 260]);
    const drawn = objects().filter(isShapeSnapshot);
    expect(drawn.length).toBe(2);
    expect(drawn.map((shape) => shape.kind)).toEqual(['ellipse', 'ellipse']);
  });

  test('TC-22 Escape puts the tool down having made nothing, from either drawing tool', async () => {
    await openBoard();

    await press('s');
    expect(surfaceOf('shape-tool-surface')).not.toBeNull();
    await press('Escape');
    expect(surfaceOf('shape-tool-surface')).toBeNull();
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(objects().filter(isShapeSnapshot).length).toBe(0);

    await press('l');
    expect(surfaceOf('connector-tool-surface')).not.toBeNull();
    await press('Escape');
    expect(surfaceOf('connector-tool-surface')).toBeNull();
    expect(button('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(objects().filter(isConnectorSnapshot).length).toBe(0);
  });


});
