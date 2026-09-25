/** Story 10 tools.active_tool component tests (TC-22): shortcuts, return to Select, Escape. */
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { snapshotObjects } from '../../src/shared/board-model';
import { TOOL_SHORTCUTS } from '../../src/client/tools/useActiveTool';
import { connectors, key, pointer, renderApp, shapes, toolButton } from './shapeHelpers';

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
});

afterEach(() => {
  vi.useRealTimers();
});

function pressed(): string[] {
  return within(screen.getByRole('toolbar', { name: 'Tools' }))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.getAttribute('aria-label')!);
}

describe('tools.active_tool', () => {
  it('TC-22 shortcut map covers the cross-story tools', () => {
    expect(TOOL_SHORTCUTS).toMatchObject({ v: 'select', n: 'sticky', t: 'text', s: 'shape', l: 'connector', p: 'pen', i: 'image', c: 'comment' });
  });

  it('TC-22 S then create → Select; L then create → Select', () => {
    renderApp(doc);
    key('s');
    expect(pressed()).toEqual(['Shape (S)']);
    pointer(screen.getByTestId('shape-tool'), 'pointerDown', { x: 300, y: 300 });
    pointer(screen.getByTestId('shape-tool'), 'pointerUp', { x: 300, y: 300 });
    expect(shapes(doc)).toHaveLength(1);
    expect(pressed()).toEqual(['Select (V)']);

    key('L');
    expect(pressed()).toEqual(['Connector (L)']);
    pointer(screen.getByTestId('connector-tool'), 'pointerDown', { x: 600, y: 600 });
    pointer(screen.getByTestId('connector-tool'), 'pointerMove', { x: 700, y: 650 });
    pointer(screen.getByTestId('connector-tool'), 'pointerUp', { x: 700, y: 650 });
    expect(connectors(doc)).toHaveLength(1);
    expect(pressed()).toEqual(['Select (V)']);
  });

  it('TC-22 S then Escape, L then Escape → Select, nothing created (buttons too)', () => {
    renderApp(doc);
    key('s');
    key('Escape');
    expect(pressed()).toEqual(['Select (V)']);
    key('l');
    key('Escape');
    expect(pressed()).toEqual(['Select (V)']);

    // Escape in the middle of a shape drag abandons it.
    key('s');
    pointer(screen.getByTestId('shape-tool'), 'pointerDown', { x: 100, y: 100 });
    pointer(screen.getByTestId('shape-tool'), 'pointerMove', { x: 300, y: 300 });
    key('Escape');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(pressed()).toEqual(['Select (V)']);

    fireEvent.click(toolButton('Shape (S)'));
    expect(pressed()).toEqual(['Shape (S)']);
    expect(screen.getByRole('menu', { name: 'Shape kind' })).toBeInTheDocument();
    fireEvent.click(toolButton('Connector (L)'));
    expect(pressed()).toEqual(['Connector (L)']);
    expect(screen.queryByRole('menu', { name: 'Shape kind' })).toBeNull();
    key('v');
    expect(pressed()).toEqual(['Select (V)']);
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  it('TC-22 unknown shortcuts (tools not in this build) change nothing', () => {
    renderApp(doc);
    // P (story 11 Pen) is part of this build now; C (story 16) is not. I (story 12) opens the
    // image file picker and never becomes the active tool.
    for (const k of ['i', 'c', 'x']) key(k);
    expect(pressed()).toEqual(['Select (V)']);
  });
});
