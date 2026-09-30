import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { objectsSnapshot } from '../../src/shared/board-model';
import { TOOL_SHORTCUTS } from '../../src/client/tools/useActiveTool';
import { keyDown, renderApp } from './helpers';

const pressed = () =>
  [...screen.getByRole('toolbar', { name: 'Tools' }).querySelectorAll('button[aria-pressed="true"]')].map((b) =>
    b.getAttribute('aria-label'),
  );
const count = () => objectsSnapshot(window.__vidi6!.doc).length;

function gesture(el: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
}

describe('tools.active_tool', () => {
  it('shortcuts follow the cross-story convention', () => {
    expect(TOOL_SHORTCUTS).toEqual({
      v: 'select', n: 'sticky', t: 'text', s: 'shape', l: 'connector', p: 'pen', i: 'image', c: 'comment',
    });
  });

  it('the toolbar lists Shape (S) and Connector (L) after the story 9 tools', () => {
    renderApp();
    const names = [...screen.getByRole('toolbar', { name: 'Tools' }).querySelectorAll('.toolbar-button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(names.slice(0, 5)).toEqual(['Select (V)', 'Text (T)', 'Sticky note (N)', 'Shape (S)', 'Connector (L)']);
    expect(screen.queryByRole('group', { name: 'Shape kind' })).toBeNull();
  });

  it('TC-22 S then create, and L then create, return to Select', () => {
    renderApp();
    keyDown(document.body, 's');
    expect(pressed()).toContain('Shape (S)');
    gesture(screen.getByTestId('shape-tool'), [100, 100], [300, 200]);
    expect(count()).toBe(1);
    expect(pressed()).toEqual(['Select (V)']);
    keyDown(document.body, 'L');
    expect(pressed()).toEqual(['Connector (L)']);
    gesture(screen.getByTestId('connector-tool'), [600, 600], [700, 650]);
    expect(count()).toBe(2);
    expect(pressed()).toEqual(['Select (V)']);
  });

  it('TC-22 S then Escape, and L then Escape (even mid-drag), return to Select and create nothing', () => {
    renderApp();
    keyDown(document.body, 's');
    keyDown(document.body, 'Escape');
    expect(pressed()).toEqual(['Select (V)']);
    keyDown(document.body, 'l');
    keyDown(document.body, 'Escape');
    expect(pressed()).toEqual(['Select (V)']);
    // Unfinished drags.
    keyDown(document.body, 's');
    const shapeLayer = screen.getByTestId('shape-tool');
    fireEvent.pointerDown(shapeLayer, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(shapeLayer, { pointerId: 1, clientX: 300, clientY: 300 });
    keyDown(document.body, 'Escape');
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 300, clientY: 300 });
    keyDown(document.body, 'l');
    const connLayer = screen.getByTestId('connector-tool');
    fireEvent.pointerDown(connLayer, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(connLayer, { pointerId: 1, clientX: 300, clientY: 300 });
    keyDown(document.body, 'Escape');
    expect(screen.queryByTestId('connector-tool')).toBeNull();
    expect(pressed()).toEqual(['Select (V)']);
    expect(count()).toBe(0);
  });

  it('V returns to Select; S and L are typing while a text field has focus', () => {
    renderApp();
    keyDown(document.body, 's');
    keyDown(document.body, 'v');
    expect(pressed()).toEqual(['Select (V)']);
    const input = document.createElement('input');
    document.body.appendChild(input);
    keyDown(input, 's');
    keyDown(input, 'l');
    expect(pressed()).toEqual(['Select (V)']);
    input.remove();
  });
});
