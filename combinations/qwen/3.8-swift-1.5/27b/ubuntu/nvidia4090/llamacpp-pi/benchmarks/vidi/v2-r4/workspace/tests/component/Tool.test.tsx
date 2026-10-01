// @vitest-environment jsdom
/**
 * Component tests — text tool mode (story 9, TC-14..TC-18).
 *
 * A small harness wires useTool to a real Toolbar and a real BoardViewport
 * (identity camera), reproducing the BoardUI wiring: a text-tool board click
 * creates a text via createText, reverts the tool to Select, and starts
 * editing the new object.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { useTool } from '../../src/client/board/useTool';
import { Toolbar } from '../../src/client/board/Toolbar';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import type { Camera } from '../../src/client/canvas/camera';
import { createSticky } from '../../src/shared/board-model';
import { createText } from '../../src/shared/objects/text';

const IDENTITY: Camera = { x: 0, y: 0, zoom: 1 };

interface HarnessProps {
  doc: Y.Doc;
  canEdit?: boolean;
  initialEditingId?: string | null;
  onEditingChange?(id: string | null): void;
}

function Harness({
  doc,
  canEdit = true,
  initialEditingId = null,
  onEditingChange,
}: HarnessProps) {
  // editingId lives in the harness state so the tool guard (editingId) sees
  // the same value BoardUI would (useSelection.editingId).
  const [editingId, setEditingId] = useStateLike(initialEditingId);
  const { tool, setTool } = useTool({
    canEdit,
    editingId,
    onCreateStickyAtCentre: () => {
      const id = createSticky(doc, { x: 0, y: 0 });
      if (id) {
        setEditingId(id);
        onEditingChange?.(id);
      }
    },
  });

  const handleTextToolClick = (screenPoint: { x: number; y: number }) => {
    const id = createText(doc, screenPoint, 'g_test');
    if (id) {
      setTool('select');
      setEditingId(id);
      onEditingChange?.(id);
    }
  };

  return (
    <div>
      <Toolbar
        tool={tool}
        setTool={setTool}
        onCreateSticky={() => {}}
        disabled={!canEdit}
      />
      <BoardViewport
        camera={IDENTITY}
        beginPan={() => {}}
        panMove={() => {}}
        endPan={() => {}}
        wheel={() => {}}
        zoomStep={() => {}}
        reset={() => {}}
        tool={tool}
        onTextToolClick={handleTextToolClick}
      />
    </div>
  );
}

// Tiny useState shim (keeps the harness readable without importing react at
// the top-level alongside the hooks used inside)
import { useState } from 'react';
function useStateLike<T>(initial: T): [T, (v: T) => void] {
  return useState<T>(initial);
}

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
});

afterEach(() => {
  cleanup();
  doc.destroy();
});

describe('Tool component tests (story 9)', () => {
  it('TC-14: T activates Text (button pressed); Escape returns to Select; V returns to Select', () => {
    render(<Harness doc={doc} />);
    const textBtn = () =>
      document.querySelector('[aria-label="Text (T)"]') as HTMLButtonElement;
    const selectBtn = () =>
      document.querySelector('[aria-label="Select (V)"]') as HTMLButtonElement;

    // T activates the text tool
    fireEvent.keyDown(document.body, { key: 't', code: 'KeyT', bubbles: true });
    expect(textBtn().getAttribute('aria-pressed')).toBe('true');
    expect(selectBtn().getAttribute('aria-pressed')).toBe('false');

    // Escape returns to Select
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', bubbles: true });
    expect(textBtn().getAttribute('aria-pressed')).toBe('false');
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');

    // T again, then V returns to Select
    fireEvent.keyDown(document.body, { key: 't', code: 'KeyT', bubbles: true });
    expect(textBtn().getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(document.body, { key: 'v', code: 'KeyV', bubbles: true });
    expect(textBtn().getAttribute('aria-pressed')).toBe('false');
    expect(selectBtn().getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-15: T is ignored when the board is not editable; Text button is disabled', () => {
    render(<Harness doc={doc} canEdit={false} />);
    const textBtn = document.querySelector('[aria-label="Text (T)"]') as HTMLButtonElement;

    fireEvent.keyDown(document.body, { key: 't', code: 'KeyT', bubbles: true });
    expect(textBtn.disabled).toBe(true);
    expect(textBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-16: while editing a note, T types "t" (tool does not switch)', () => {
    render(
      <Harness doc={doc} initialEditingId="note-1" />,
    );
    // Simulate a focused editor textarea (the guard checks the event target)
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const ev = new KeyboardEvent('keydown', {
      key: 't',
      code: 'KeyT',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      textarea.dispatchEvent(ev);
    });
    // Not prevented → the browser would type the character
    expect(ev.defaultPrevented).toBe(false);
    // Tool unchanged (Text button not pressed)
    const textBtn = document.querySelector('[aria-label="Text (T)"]') as HTMLButtonElement;
    expect(textBtn.getAttribute('aria-pressed')).toBe('false');
    textarea.remove();
  });

  it('TC-17: Text tool + board click creates text at the point, tool reverts to Select, editing starts', () => {
    let editingId: string | null = null;
    render(<Harness doc={doc} onEditingChange={(id) => (editingId = id)} />);

    // Activate the text tool
    fireEvent.keyDown(document.body, { key: 't', code: 'KeyT', bubbles: true });
    const textBtn = document.querySelector('[aria-label="Text (T)"]') as HTMLButtonElement;
    expect(textBtn.getAttribute('aria-pressed')).toBe('true');

    // Click the board at (100, 50) — identity camera ⇒ world (100, 50).
    // jsdom has no PointerEvent constructor, so use a MouseEvent (the
    // capture listener only reads clientX/clientY/button).
    const area = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    const pd = new MouseEvent('pointerdown', {
      clientX: 100,
      clientY: 50,
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      area.dispatchEvent(pd);
    });

    // A text object was created at the world point
    const objects = doc.getMap('objects');
    expect(objects.size).toBe(1);
    const id = [...objects.keys()][0];
    const obj = objects.get(id) as Y.Map<unknown>;
    expect(obj.get('type')).toBe('text');
    expect(obj.get('x')).toBe(100);
    expect(obj.get('y')).toBe(50);

    // Tool reverted to Select and editing started
    expect(textBtn.getAttribute('aria-pressed')).toBe('false');
    expect(editingId).toBe(id);
  });

  it('TC-18: N still creates a sticky at the view centre (regression)', () => {
    let editingId: string | null = null;
    render(<Harness doc={doc} onEditingChange={(id) => (editingId = id)} />);

    fireEvent.keyDown(document.body, { key: 'n', code: 'KeyN', bubbles: true });
    const objects = doc.getMap('objects');
    expect(objects.size).toBe(1);
    const obj = objects.get([...objects.keys()][0]) as Y.Map<unknown>;
    expect(obj.get('type')).toBe('sticky');
    expect(editingId).toBeTruthy();
  });
});
