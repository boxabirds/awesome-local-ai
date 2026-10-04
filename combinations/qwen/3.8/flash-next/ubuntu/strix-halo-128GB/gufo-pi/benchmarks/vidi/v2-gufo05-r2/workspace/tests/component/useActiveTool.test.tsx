/**
 * Story 10, `tool.shortcut` and `tool.create`: which tool the page is holding.
 *
 * These are the parts of holding a tool that are not on screen — the keys, the way a
 * creation puts the hand back to Select, and the fact that a tool nobody implemented is
 * not held just because its letter was pressed. A probe component uses the hook the same
 * way the board does, so the rules are tested where they live; the board itself is
 * exercised by the shape and connector tests, and by the browser tests.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useActiveTool, type ActiveToolState, type ToolId } from '../../src/client/tools/useActiveTool';
import type { ShapeKind } from '../../src/shared/objects/shape';
import { fireKey, flushFrames } from './boardHarness';

afterEach(() => cleanup());

/** What the probe saw, in order, so a test can read the rule rather than the render. */
let created: string[] = [];
let stickies: number;
let view: ActiveToolState | null = null;

function Probe({ canEdit = true }: { canEdit?: boolean }) {
  const tools = useActiveTool({
    canEdit,
    onCreateSticky: () => {
      stickies += 1;
    },
    select: (id) => {
      created.push(id);
    },
  });
  view = tools;
  return (
    <div>
      <span data-testid="tool">{tools.tool}</span>
      <span data-testid="shape-kind">{tools.shapeKind}</span>
      <input data-testid="field" />
    </div>
  );
}

function mount(canEdit?: boolean): void {
  created = [];
  stickies = 0;
  view = null;
  render(<Probe canEdit={canEdit} />);
  flushFrames();
}

function tool(): ToolId {
  return screen.getByTestId('tool').textContent as ToolId;
}

function kind(): ShapeKind {
  return screen.getByTestId('shape-kind').textContent as ShapeKind;
}

function press(key: string, modifiers: { ctrl?: boolean; meta?: boolean } = {}): void {
  fireKey(key, modifiers);
  flushFrames();
}

describe('tool.shortcut — the keys that pick a tool', () => {
  it('TC-22: S and L pick the drawing tools; V and Escape put them down', () => {
    mount();
    expect(tool()).toBe('select');

    press('s');
    expect(tool()).toBe('shape');
    press('Escape');
    expect(tool()).toBe('select');

    press('l');
    expect(tool()).toBe('connector');
    press('v');
    expect(tool()).toBe('select');

    // Upper case is the same key.
    press('S');
    expect(tool()).toBe('shape');
  });

  it('T still picks the Text tool and N still makes a note without being held', () => {
    mount();
    press('t');
    expect(tool()).toBe('text');
    press('Escape');

    press('n');
    expect(stickies).toBe(1);
    expect(tool()).toBe('select');
  });

  it('P picks the pen, and a pen stroke does not put the pen down', () => {
    mount();
    press('p');
    expect(tool()).toBe('pen');
    // Nothing about holding a pen creates an object, so nothing hands the selection back
    // and nothing returns the hand to Select (PRD pen.stay_active): the next line is
    // usually wanted too.
    expect(created).toEqual([]);
    press('p');
    expect(tool()).toBe('pen');
    // What puts it down is Escape, or another tool.
    press('Escape');
    expect(tool()).toBe('select');
    press('p');
    press('v');
    expect(tool()).toBe('select');
  });

  it('a tool with no interface is not held, and an unknown key does nothing', () => {
    mount();
    // The Image and the Comment are in settings' list of tools with no behaviour yet, so
    // they are not held and have no key of their own: holding them would leave the page
    // promising to draw. (The Pen was one of these until story 11 gave it a gesture; it is
    // tested with the other tools, above.)
    for (const key of ['i', 'c', 'x', 'z', '1']) {
      press(key);
      expect(tool()).toBe('select');
    }
  });

  it('a shortcut typed into a field is a letter, and Ctrl/Cmd is somebody else’s chord', () => {
    mount();
    const field = screen.getByTestId('field');
    act(() => {
      field.focus();
    });
    // A browser sends the key to the focused element; the shortcut has to notice that
    // and leave the letter to the field.
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }),
      );
    });
    flushFrames();
    expect(tool()).toBe('select');
    act(() => {
      field.blur();
    });

    press('s', { ctrl: true });
    expect(tool()).toBe('select');
    press('s', { meta: true });
    expect(tool()).toBe('select');
  });

  it('a read-only page cannot hold a creating tool, and loses one it is holding', () => {
    mount(false);
    press('s');
    expect(tool()).toBe('select');
    act(() => {
      view?.setTool('connector');
    });
    expect(tool()).toBe('select');
    // N on a board you may not write to makes nothing.
    press('n');
    expect(stickies).toBe(0);
  });
});

describe('tool.create — what a finished creation does', () => {
  it('TC-22b: creating selects the new thing and goes back to Select', () => {
    mount();
    press('s');
    expect(tool()).toBe('shape');
    act(() => {
      view?.toolCreated('shape-1');
    });
    flushFrames();
    expect(created).toEqual(['shape-1']);
    expect(tool()).toBe('select');

    press('l');
    act(() => {
      view?.toolCreated('connector-1');
    });
    flushFrames();
    expect(created).toEqual(['shape-1', 'connector-1']);
    expect(tool()).toBe('select');
  });

  it('the shape kind survives picking tools, because it is the Shape tool’s setting', () => {
    mount();
    expect(kind()).toBe('rect');
    act(() => {
      view?.setShapeKind('diamond');
    });
    flushFrames();
    expect(kind()).toBe('diamond');

    press('l');
    press('Escape');
    expect(kind()).toBe('diamond');

    // An unknown kind is not a kind.
    act(() => {
      view?.setShapeKind('hexagon' as ShapeKind);
    });
    flushFrames();
    expect(kind()).toBe('diamond');
  });
});
