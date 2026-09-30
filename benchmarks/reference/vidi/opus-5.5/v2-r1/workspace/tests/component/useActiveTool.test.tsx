// tools.active_tool (TC-22): shortcuts, return to Select after creating, Escape.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { objectsSnapshot } from '../../src/shared/board-model';
import { dispatchKey, useFakeFrames } from './helpers';
import { connectorsOf, pressedTool, shapesOf, toolButton } from './shapeHelpers';
import { renderApp } from './stickyHelpers';

beforeEach(() => useFakeFrames());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function drag(el: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1], button: 0, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], pointerId: 1 });
}

describe('tools.active_tool', () => {
  it('TC-22 S or L then create returns to Select; S or L then Escape returns to Select creating nothing', () => {
    const { doc } = renderApp();
    dispatchKey({ key: 's' });
    expect(pressedTool()).toBe('Shape (S)');
    drag(screen.getByTestId('shape-tool'), [100, 100], [300, 220]);
    expect(shapesOf(doc)).toHaveLength(1);
    expect(pressedTool()).toBe('Select (V)');

    dispatchKey({ key: 'L' });
    expect(pressedTool()).toBe('Connector (L)');
    drag(screen.getByTestId('connector-tool'), [500, 500], [600, 600]);
    expect(connectorsOf(doc)).toHaveLength(1);
    expect(pressedTool()).toBe('Select (V)');

    const before = objectsSnapshot(doc).length;
    dispatchKey({ key: 's' });
    dispatchKey({ key: 'Escape' });
    expect(pressedTool()).toBe('Select (V)');
    dispatchKey({ key: 'l' });
    dispatchKey({ key: 'Escape' });
    expect(pressedTool()).toBe('Select (V)');
    expect(objectsSnapshot(doc)).toHaveLength(before);
  });

  it('Escape during an unfinished drag creates nothing', () => {
    const { doc } = renderApp();
    dispatchKey({ key: 's' });
    const layer = screen.getByTestId('shape-tool');
    fireEvent.pointerDown(layer, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 300, clientY: 300, pointerId: 1 });
    dispatchKey({ key: 'Escape' });
    fireEvent.pointerUp(document.body, { clientX: 300, clientY: 300, pointerId: 1 });
    dispatchKey({ key: 'l' });
    const tool = screen.getByTestId('connector-tool');
    fireEvent.pointerDown(tool, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(tool, { clientX: 300, clientY: 300, pointerId: 1 });
    dispatchKey({ key: 'Escape' });
    fireEvent.pointerUp(document.body, { clientX: 300, clientY: 300, pointerId: 1 });
    expect(objectsSnapshot(doc)).toHaveLength(0);
    expect(pressedTool()).toBe('Select (V)');
  });

  it('the toolbar buttons and V switch tools; the kind menu shows only with Shape active', () => {
    renderApp();
    expect(screen.queryByRole('group', { name: 'Shape kind' })).toBeNull();
    fireEvent.click(toolButton('Shape (S)'));
    expect(screen.getByRole('group', { name: 'Shape kind' })).toBeTruthy();
    expect(toolButton('Rectangle').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toolButton('Connector (L)'));
    expect(pressedTool()).toBe('Connector (L)');
    expect(screen.queryByRole('group', { name: 'Shape kind' })).toBeNull();
    dispatchKey({ key: 'v' });
    expect(pressedTool()).toBe('Select (V)');
    // Shortcuts are ignored with modifiers.
    dispatchKey({ key: 's', shiftKey: true });
    expect(pressedTool()).toBe('Select (V)');
  });
});
