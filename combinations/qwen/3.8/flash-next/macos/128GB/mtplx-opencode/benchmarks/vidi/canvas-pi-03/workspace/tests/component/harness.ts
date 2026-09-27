import { act } from '@testing-library/react';

/** Build a pointer-style event (jsdom has no PointerEvent constructor; React
 * dispatches by event name, so a MouseEvent carrying a pointerId is enough). */
export function pointerEvent(type: string, x: number, y: number, button = 0): MouseEvent {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
  });
  (ev as unknown as { pointerId: number }).pointerId = 1;
  return ev;
}

export function fire(el: EventTarget, ev: Event): void {
  act(() => {
    el.dispatchEvent(ev);
  });
}

/** Seed a note through the test-mode App hook and return its id. */
export function seed(x: number, y: number, color?: string): string {
  const w = window as unknown as { __vidi6: { seedSticky(x: number, y: number, c?: string): string } };
  let id = '';
  act(() => {
    id = w.__vidi6.seedSticky(x, y, color);
  });
  return id;
}

export function boardState(): { selectedId: string | null; editingId: string | null } {
  const w = window as unknown as { __vidi6: { getState(): { selectedId: string | null; editingId: string | null } } };
  return w.__vidi6.getState();
}

export function pressKey(
  key: string,
  target: EventTarget = window,
  init: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}
/* ---- story 7: multi-object helpers ------------------------------------- */

interface TestHook {
  __vidi6: {
    seedSticky(x: number, y: number, c?: string): string;
    selectAll(): void;
    selection(): string[];
    getCamera(): { x: number; y: number; zoom: number };
    setCamera(c: { x: number; y: number; zoom: number }): void;
    snapshot(): Array<{ id: string; x: number; y: number; width?: number; height?: number }>;
  };
}

function hook(): TestHook['__vidi6'] {
  return (window as unknown as TestHook).__vidi6;
}

/** Seed a cluster of notes from world points, returning their ids in order. */
export function seedCluster(points: Array<[number, number]>): string[] {
  const ids: string[] = [];
  act(() => {
    for (const [x, y] of points) ids.push(hook().seedSticky(x, y));
  });
  return ids;
}

/** Replace the selection with every object on the board. */
export function selectAll(): void {
  act(() => {
    hook().selectAll();
  });
}

/** The ids currently selected. */
export function selectedIds(): string[] {
  return hook().selection();
}

/** Put the camera somewhere exact, so a gesture can be compared across zooms. */
export function setCamera(x: number, y: number, zoom: number): void {
  act(() => {
    hook().setCamera({ x, y, zoom });
  });
}

/** A pointer event with modifiers (marquee needs Shift, undo needs Meta). */
export function pointerEventEx(
  type: string,
  x: number,
  y: number,
  options: { shift?: boolean; meta?: boolean; ctrl?: boolean; button?: number } = {},
): MouseEvent {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: options.button ?? 0,
    shiftKey: options.shift ?? false,
    metaKey: options.meta ?? false,
    ctrlKey: options.ctrl ?? false,
  });
  (ev as unknown as { pointerId: number }).pointerId = 1;
  return ev;
}

/* ---- story 9: free-text helpers ---------------------------------------- */

interface TextBlockState {
  text: string;
  size: string;
  widthMode: 'auto' | 'fixed';
  width: number;
  height: number;
}

type Story9Hook = TestHook['__vidi6'] & {
  seedText(x: number, y: number): string | null;
  tool(): 'select' | 'text';
  textBlock(id: string): TextBlockState | null;
  startEdit(id: string): void;
  deleteSticky(id: string): void;
};

function hook9(): Story9Hook {
  return (window as unknown as { __vidi6: Story9Hook }).__vidi6;
}

/** Place a text block (with a short line of text) at a world point. */
export function seedText(x: number, y: number): string {
  let id: string | null = null;
  act(() => {
    id = hook9().seedText(x, y);
  });
  if (id === null) throw new Error('seedText created nothing');
  return id;
}

export function tool(): 'select' | 'text' {
  return hook9().tool();
}

export function textBlock(id: string): TextBlockState | null {
  return hook9().textBlock(id);
}

export function blockEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
  if (!el) throw new Error(`text block ${id} not found`);
  return el;
}

/** Press and release on a block: a click, no drag. */
export function clickBlock(id: string, x = 400, y = 400): void {
  const el = blockEl(id);
  fire(el, pointerEvent('pointerdown', x, y));
  fire(el, pointerEvent('pointerup', x, y));
}

/** Take a block out of the document the way a peer's update would: the object
 * is simply gone the next time the board is read. */
export function deleteBlock(id: string): void {
  const w = window as unknown as { __vidi6: { doc: { getMap: (k: string) => { delete(key: string): void } } } };
  act(() => {
    w.__vidi6.doc.getMap('objects').delete(id);
  });
}
