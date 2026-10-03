import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { renderApp, pressNote, shiftPressNote, dragNote } from './appHarness';
import { registerObjectType, type ObjectProps } from '../../src/client/objects/registry';

// A minimal mock object type to prove the registry contract (stories 9–12):
// it renders, can be selected and moved, and has no resize handles.
// (Registered once at module scope; vitest isolates modules per test file.)
function TestBox(props: ObjectProps): JSX.Element {
  const { obj, selected, onObjectPointerDown } = props;
  return (
    <div
      data-note-id={obj.id}
      data-selected={selected}
      data-testid="testbox"
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width: 120,
        height: 80,
        background: '#333',
        color: '#fff',
        outline: selected ? '2px solid #1A73E8' : 'none',
        boxSizing: 'border-box',
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onObjectPointerDown(e, obj.id);
      }}
    >
      testbox
    </div>
  );
}

registerObjectType('testbox', {
  Component: TestBox,
  resizable: false,
  aspectLocked: false,
  minSize: 10,
  editableText: false,
  hitTest: (obj, p) => p.x >= obj.x && p.x < obj.x + 120 && p.y >= obj.y && p.y < obj.y + 80,
});

/** Creates a testbox object in the doc (world top-left x, y). */
function addTestBox(doc: Y.Doc, x: number, y: number, id = 'tb-' + Math.random().toString(36).slice(2, 10)): string {
  const objects = doc.getMap('objects');
  let z = 0;
  objects.forEach((o) => {
    const oz = (o as Y.Map<unknown>).get('z');
    if (typeof oz === 'number' && oz > z) z = oz;
  });
  const obj = new Y.Map<unknown>();
  obj.set('type', 'testbox');
  obj.set('x', x);
  obj.set('y', y);
  obj.set('z', z + 1);
  obj.set('createdAt', Date.now());
  objects.set(id, obj);
  return id;
}

describe('registry: a new object type (story 7, ui-component)', () => {
  it('TC-24: testbox renders, can be selected and group-moved, and shows no resize handles', async () => {
    const app = await renderApp();
    const noteId = app.addNote({ x: 100, y: 100 });
    const boxId = 'tb1';
    act(() => {
      addTestBox(app.doc, 400, 100, boxId);
    });

    // rendered through the registry
    expect(screen.getByTestId('testbox')).toBeTruthy();

    // can be selected with a plain click
    pressNote(app, boxId);
    expect(app.note(boxId).getAttribute('data-selected')).toBe('true');
    expect(app.note(noteId).getAttribute('data-selected')).toBe('false');

    // no resize handles: the testbox type is not resizable
    expect(screen.queryByTestId('resize-handle-se')).toBeNull();

    // group move: select the note too, drag the testbox → both move
    // note left-top (0,0); testbox left-top (400,100)
    shiftPressNote(app, noteId);
    act(() => {
      dragNote(app, boxId, 25, -15);
    });
    const byId = new Map(app.notes().map((n) => [n.id, n]));
    expect(byId.get(noteId)!.x).toBe(25);
    expect(byId.get(noteId)!.y).toBe(-15);
    const boxEl = app.note(boxId);
    expect(getComputedStyle(boxEl).left).toBe('425px');
    expect(getComputedStyle(boxEl).top).toBe('85px');
  });
});
