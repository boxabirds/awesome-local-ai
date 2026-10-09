import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef, useState, type JSX, type MutableRefObject } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import { initDoc, snapshotAll, type ObjectSnapshot } from '../../src/shared/board-model';
import { createSticky } from '../../src/shared/board-model';
import { screenToWorld } from '../../src/client/canvas/camera';

interface ToolRegistry {
  doc: Y.Doc;
  selection: SelectionApi;
}

let registry: MutableRefObject<ToolRegistry | null> = { current: null };

// Mirrors BoardShell enough to exercise the tool UI through the real
// BoardViewport: live snapshot, selection and editable flag.
function ToolHarness(props: { canEdit?: boolean }): JSX.Element {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    docRef.current = new Y.Doc();
    initDoc(docRef.current);
  }
  const doc = docRef.current;
  const [notes, setNotes] = useState<readonly ObjectSnapshot[]>(() => snapshotAll(doc));
  useEffect(() => {
    const objects = doc.getMap('objects');
    const observer = (): void => setNotes(snapshotAll(doc));
    objects.observeDeep(observer);
    return () => objects.unobserveDeep(observer);
  }, [doc]);
  const selection = useSelection(notes);
  registry.current = { doc, selection };
  return <BoardViewport doc={doc} notes={notes} selection={selection} editable={props.canEdit !== false} />;
}

function ctrl(): ToolRegistry {
  return registry.current!;
}

function press(key: string, target: Window | Node = window): void {
  fireEvent.keyDown(target, { key });
}

function textButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Text (T)' }) as HTMLButtonElement;
}

function selectButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Select (V)' }) as HTMLButtonElement;
}

function pressed(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-pressed') === 'true';
}

function objects(): ObjectSnapshot[] {
  return [...snapshotAll(ctrl().doc)];
}

beforeEach(() => {
  registry = { current: null };
});

afterEach(() => {
  cleanup();
});

describe('text.tool_ui', () => {
  test('TC-14 T activates Text, Escape and V return to Select', () => {
    render(<ToolHarness />);
    expect(pressed(selectButton())).toBe(true);
    expect(pressed(textButton())).toBe(false);
    press('t');
    expect(pressed(textButton())).toBe(true);
    expect(pressed(selectButton())).toBe(false);
    press('Escape');
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
    press('t');
    expect(pressed(textButton())).toBe(true);
    press('v');
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
  });

  test('TC-15 with canEdit false, T is ignored and the Text button is disabled', () => {
    render(<ToolHarness canEdit={false} />);
    expect(textButton().disabled).toBe(true);
    press('t');
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
  });

  test('TC-16 T while editing a sticky types the character and leaves the tool alone', () => {
    render(<ToolHarness />);
    let id = '';
    act(() => {
      id = createSticky(ctrl().doc, { x: 0, y: 0 }) as string;
    });
    act(() => {
      ctrl().selection.startEdit(id);
    });
    const editor = document.querySelector<HTMLElement>('[data-testid$="-editor"]') ?? document.querySelector<HTMLElement>('[contenteditable="true"]');
    expect(editor).not.toBeNull();
    press('t', editor!);
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
    expect(ctrl().selection.editingId).toBe(id);
  });

  test('TC-17 Text active, clicking the board creates text at screenToWorld, selects+edits it and returns to Select', () => {
    render(<ToolHarness />);
    press('t');
    const overlay = screen.getByTestId('text-tool-overlay');
    // Pointer down on the overlay must not start a pan.
    fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 300, clientY: 200 });
    expect(screen.getByTestId('board-viewport').getAttribute('data-interaction')).toBe('idle');
    fireEvent.pointerUp(overlay, { pointerId: 1 });
    fireEvent.click(overlay, { clientX: 300, clientY: 200 });
    const created = objects().filter((obj) => obj.type === 'text');
    expect(created.length).toBe(1);
    const world = screenToWorld(
      { x: -window.innerWidth / 2, y: -window.innerHeight / 2, zoom: 1 },
      { x: 300, y: 200 }
    );
    expect(created[0].x).toBeCloseTo(world.x, 3);
    expect(created[0].y).toBeCloseTo(world.y, 3);
    expect(pressed(textButton())).toBe(false);
    expect(ctrl().selection.editingId).toBe(created[0].id);
    // The editor for the new text is mounted.
    expect(document.querySelector(`[data-testid="text-editor-${created[0].id}"]`)).not.toBeNull();
  });

  test('TC-18 N creates a sticky at the view centre (story 2 regression)', () => {
    render(<ToolHarness />);
    expect(objects().filter((obj) => obj.type === 'sticky').length).toBe(0);
    press('n');
    const stickies = objects().filter((obj) => obj.type === 'sticky');
    expect(stickies.length).toBe(1);
    // Camera reset puts the view centre at world (0, 0).
    expect(stickies[0].x).toBeCloseTo(-100, 3);
    expect(stickies[0].y).toBeCloseTo(-100, 3);
  });

  test('tool state reverts to Select when the board becomes read-only', () => {
    const { rerender } = render(<ToolHarness canEdit />);
    press('t');
    expect(pressed(textButton())).toBe(true);
    rerender(<ToolHarness canEdit={false} />);
    expect(pressed(textButton())).toBe(false);
    expect(pressed(selectButton())).toBe(true);
  });
});
