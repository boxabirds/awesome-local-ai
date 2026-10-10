// Shared helpers for story 7 component tests: a test-only registered object
// type (sel.all_types proof) and pointer-drag utilities.

import * as Y from 'yjs';
import { act, fireEvent } from '@testing-library/react';
import { board, flush } from './stickyHelpers';
import { getObjectType, registerObjectType, type ObjectProps } from '../../src/client/objects/registry';

export function Testbox({ obj, selected, onObjectPointerDown }: ObjectProps): React.JSX.Element {
  return (
    <div
      data-testid="testbox"
      data-note-id={obj.id}
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: obj.width ?? 100,
        height: obj.height ?? 100,
        background: '#dde',
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onObjectPointerDown(e, obj.id);
      }}
    />
  );
}

export function ensureTestbox(): void {
  if (getObjectType('testbox')) return;
  registerObjectType('testbox', {
    Component: Testbox,
    resizable: true,
    aspectLocked: false,
    minSize: 10,
    editableText: false,
    hitTest: (o, p) => {
      const w = o.width ?? 100;
      const h = o.height ?? 100;
      return p.x >= o.x && p.y >= o.y && p.x <= o.x + w && p.y <= o.y + h;
    },
  });
}

let testboxSeq = 0;

export function createTestbox(x = 0, y = 0, width = 100, height = 80): string {
  ensureTestbox();
  const id = `tb${++testboxSeq}`;
  act(() => {
    const m = new Y.Map<unknown>();
    m.set('type', 'testbox');
    m.set('x', x);
    m.set('y', y);
    m.set('z', 1);
    m.set('createdAt', Date.now());
    m.set('width', width);
    m.set('height', height);
    board().doc.getMap<Y.Map<unknown>>('objects').set(id, m);
  });
  flush();
  return id;
}

export function testboxEl(id: string): HTMLElement {
  const el = screen_find('testbox', id);
  if (!el) throw new Error(`testbox ${id} not rendered`);
  return el;
}

function screen_find(testid: string, noteId: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll(`[data-testid="${testid}"]`)).find(
    (n) => n.getAttribute('data-note-id') === noteId,
  ) as HTMLElement | undefined;
}

// Reads persisted fields of any object straight from the doc.
export function objectFields(
  id: string,
): { x: number; y: number; z: number; width?: number; height?: number } {
  const m = board().doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!m) throw new Error(`object ${id} missing`);
  const out = {
    x: m.get('x') as number,
    y: m.get('y') as number,
    z: m.get('z') as number,
  } as { x: number; y: number; z: number; width?: number; height?: number };
  const w = m.get('width');
  const h = m.get('height');
  if (typeof w === 'number') out.width = w;
  if (typeof h === 'number') out.height = h;
  return out;
}

export function dragPath(
  startEl: HTMLElement,
  path: ReadonlyArray<readonly [number, number]>,
  shift = false,
): void {
  const [x0, y0] = path[0];
  fireEvent.pointerDown(startEl, { pointerId: 1, clientX: x0, clientY: y0, shiftKey: shift, button: 0 });
  for (let i = 1; i < path.length; i += 1) {
    fireEvent.pointerMove(startEl, {
      pointerId: 1,
      clientX: path[i][0],
      clientY: path[i][1],
      shiftKey: shift,
    });
    flush();
  }
  const last = path[path.length - 1];
  fireEvent.pointerUp(startEl, { pointerId: 1, clientX: last[0], clientY: last[1], shiftKey: shift });
}

export function keyWith(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(ev);
  });
  return ev;
}
