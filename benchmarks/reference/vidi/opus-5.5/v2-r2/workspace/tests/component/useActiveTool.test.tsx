import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { TOOL_SHORTCUTS, useActiveTool } from '../../src/client/tools/useActiveTool';
import { initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import { pointer } from './helpers';

const CENTRE = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

function setup() {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  const doc = new Y.Doc();
  initDoc(doc);
  render(<App doc={doc} />);
  return doc;
}

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const key = (k: string) => fireEvent.keyDown(window, { key: k });
const count = (doc: Y.Doc, type: string) => objectsSnapshot(doc).filter((o) => o.type === type).length;

describe('tools.active_tool', () => {
  it('shortcut table follows the cross-story convention', () => {
    expect(TOOL_SHORTCUTS).toEqual({
      v: 'select',
      n: 'sticky',
      t: 'text',
      s: 'shape',
      l: 'connector',
      p: 'pen',
      i: 'image',
      c: 'comment',
    });
  });

  it('useActiveTool: toolCreated selects the id and returns to Select; editing tools need canEdit', () => {
    const onSelect = vi.fn();
    const { result, rerender } = renderHook(({ canEdit }) => useActiveTool({ canEdit, onSelect }), {
      initialProps: { canEdit: true },
    });
    expect(result.current.tool).toBe('select');
    expect(result.current.shapeKind).toBe('rect');
    act(() => result.current.setTool('shape'));
    act(() => result.current.setShapeKind('ellipse'));
    expect(result.current).toMatchObject({ tool: 'shape', shapeKind: 'ellipse' });
    act(() => result.current.toolCreated('new-id'));
    expect(onSelect).toHaveBeenCalledWith('new-id');
    expect(result.current.tool).toBe('select');
    // Tools of stories not in this build are ignored.
    act(() => result.current.setTool('image'));
    expect(result.current.tool).toBe('select');
    rerender({ canEdit: false });
    act(() => result.current.setTool('connector'));
    expect(result.current.tool).toBe('select');
  });

  it('TC-22 S then create, L then create → Select; S/L then Escape → Select, nothing created', () => {
    const doc = setup();
    const a = createShape(doc, { kind: 'rect', rect: { x: -400, y: -100, width: 100, height: 100 }, at: { x: 0, y: 0 } }, 'g')!;

    key('s');
    expect(pressed('Shape (S)')).toBe('true');
    pointer(screen.getByTestId('shape-tool'), 'down', CENTRE.x, CENTRE.y);
    pointer(screen.getByTestId('shape-tool'), 'up', CENTRE.x, CENTRE.y);
    expect(count(doc, 'shape')).toBe(2);
    expect(pressed('Select (V)')).toBe('true');
    const shape = objectsSnapshot(doc).find((o) => o.type === 'shape' && o.id !== a)!;
    expect(window.__vidi6?.getSelection?.()).toEqual([shape.id]);

    key('L');
    expect(pressed('Connector (L)')).toBe('true');
    pointer(screen.getByTestId('connector-tool'), 'down', CENTRE.x - 350, CENTRE.y - 50);
    pointer(screen.getByTestId('connector-tool'), 'up', CENTRE.x, CENTRE.y);
    expect(count(doc, 'connector')).toBe(1);
    expect(pressed('Select (V)')).toBe('true');
    const arrow = objectsSnapshot(doc).find((o) => o.type === 'connector')!;
    expect(window.__vidi6?.getSelection?.()).toEqual([arrow.id]);

    // Escape during an unfinished drag: nothing is created.
    key('s');
    pointer(screen.getByTestId('shape-tool'), 'down', CENTRE.x + 100, CENTRE.y);
    pointer(screen.getByTestId('shape-tool'), 'move', CENTRE.x + 300, CENTRE.y + 200);
    key('Escape');
    expect(pressed('Select (V)')).toBe('true');
    expect(screen.queryByTestId('shape-tool')).toBeNull();

    key('l');
    pointer(screen.getByTestId('connector-tool'), 'down', CENTRE.x + 100, CENTRE.y);
    pointer(screen.getByTestId('connector-tool'), 'move', CENTRE.x + 300, CENTRE.y + 200);
    key('Escape');
    expect(pressed('Select (V)')).toBe('true');
    expect(screen.queryByTestId('connector-tool')).toBeNull();

    expect(count(doc, 'shape')).toBe(2);
    expect(count(doc, 'connector')).toBe(1);
    // The selection made by the last creation is kept.
    expect(window.__vidi6?.getSelection?.()).toEqual([arrow.id]);
  });

  it('S and L are ignored with Ctrl/Cmd and while typing', () => {
    setup();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'l', metaKey: true });
    expect(pressed('Select (V)')).toBe('true');
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 's' });
    expect(pressed('Select (V)')).toBe('true');
    input.remove();
  });
});
