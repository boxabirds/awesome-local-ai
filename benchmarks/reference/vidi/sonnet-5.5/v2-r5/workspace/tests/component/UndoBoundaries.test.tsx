import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { createUndo } from '../../src/client/board/undo';
import {
  createSticky, getStickyText, moveObjects, setStickyColor, snapshotObjects, type StickySnapshot,
} from '../../src/shared/board-model';
import { Harness, newDoc } from './helpers';

afterEach(cleanup);

const at = (doc: Y.Doc, id: string) => snapshotObjects(doc).find((o) => o.id === id)! as StickySnapshot;
const el = (id: string) => document.querySelector(`[data-id="${id}"]`) as HTMLElement;
const FRAMES = 30;
const frame = () => new Promise((r) => setTimeout(r, 25));

async function dragFrames(target: Element, pointerUp: boolean) {
  fireEvent.pointerDown(target, { clientX: 100, clientY: 100, pointerId: 1 });
  for (let i = 1; i <= FRAMES; i++) {
    fireEvent.pointerMove(target, { clientX: 100 + i * 10, clientY: 100 + i * 5, pointerId: 1 });
    await act(frame);
  }
  if (pointerUp) fireEvent.pointerUp(target, { clientX: 400, clientY: 250, pointerId: 1 });
  else fireEvent.pointerCancel(target, { pointerId: 1 });
}

function setup() {
  const doc = newDoc();
  const undo = createUndo(doc);
  const a = createSticky(doc, { x: 100, y: 100 }) as string;
  const b = createSticky(doc, { x: 600, y: 100 }) as string;
  undo.boundary();
  const start = new Map([a, b].map((id) => [id, { x: at(doc, id).x, y: at(doc, id).y }]));
  render(<Harness doc={doc} undo={undo} />);
  return { doc, undo, a, b, start };
}

describe('undo step boundaries', () => {
  it('TC-14 a 30-frame drag of a selection is one step restoring every start position', async () => {
    const { doc, undo, a, b, start } = setup();
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    await dragFrames(el(a), true);
    expect(at(doc, a).x).toBeGreaterThan(start.get(a)!.x + 100);
    undo.undo();
    for (const id of [a, b]) {
      expect({ x: at(doc, id).x, y: at(doc, id).y }).toEqual(start.get(id));
    }
  });

  it('TC-15 a drag and a colour change right after are two separate steps', async () => {
    const { doc, undo, a, start } = setup();
    await dragFrames(el(a), true);
    const moved = { x: at(doc, a).x, y: at(doc, a).y };
    setStickyColor(doc, a, 'pink');
    undo.undo();
    expect(at(doc, a).color).toBe('yellow');
    expect({ x: at(doc, a).x, y: at(doc, a).y }).toEqual(moved);
    undo.undo();
    expect({ x: at(doc, a).x, y: at(doc, a).y }).toEqual(start.get(a));
  });

  it('TC-16 Ctrl+Z inside the editor undoes the typing, not the earlier move', async () => {
    const user = userEvent.setup();
    const { doc, a } = setup();
    moveObjects(doc, new Map([[a, { x: 900, y: 900 }]]));
    fireEvent.pointerDown(el(a), { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(el(a), { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.doubleClick(el(a));
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.keyboard('hello');
    expect(getStickyText(doc, a)!.toString()).toBe('hello');
    await user.keyboard('{Control>}z{/Control}');
    expect(getStickyText(doc, a)!.toString()).toBe('');
    expect(area.value).toBe('');
    expect(at(doc, a).x).toBe(900);
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(area.value).toBe('hello');
  });

  it('TC-17 a drag cancelled midway is still one step restoring the start', async () => {
    const { doc, undo, a, start } = setup();
    await dragFrames(el(a), false);
    expect(at(doc, a).x).not.toBe(start.get(a)!.x);
    undo.undo();
    expect({ x: at(doc, a).x, y: at(doc, a).y }).toEqual(start.get(a));
  });
});
