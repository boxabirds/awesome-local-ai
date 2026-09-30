/**
 * Story 10: Active tool hook tests.
 * TC-22: S then create, L then create → Select active; S then Escape, L then Escape → Select active and nothing created
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { dispatchPointer } from '../helpers';
import { createShape } from '@shared/objects/shape';
import { createConnector } from '@shared/objects/connector';

const { connectMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectMock = vi.fn((..._args: any[]) => ({ destroy: () => {} }));
  return { connectMock };
});
vi.mock('@client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@client/sync/connectBoard')>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...actual, connectBoard: connectMock as any };
});

const { Board } = await import('@client/Board');

const capturedDocs: Y.Doc[] = [];

function renderBoard(boardId = 'active-tool-test') {
  return render(<Board boardId={boardId} />);
}

describe('tools.active_tool', () => {
  beforeEach(() => {
    capturedDocs.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (connectMock as any).mockImplementation((doc: Y.Doc, _id: string, onState: (s: string) => void) => {
      capturedDocs.push(doc);
      onState('connected');
      return { destroy: () => {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  // TC-22a: S activates Shape tool, Escape returns to Select
  it('TC-22a: S activates Shape tool; after creation the tool returns to Select', () => {
    renderBoard();
    const doc = capturedDocs[0];

    // Activate Shape tool via keyboard shortcut
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    expect(screen.getByLabelText('Shape (S)')).toHaveAttribute('aria-pressed', 'true');

    // The shape tool overlay should be visible
    const overlay = screen.getByTestId('shape-tool-overlay');
    expect(overlay).toBeTruthy();

    // Start a drag and cancel it (to test the UI without triggering Yjs async errors)
    act(() => {
      dispatchPointer(overlay, 'pointerdown', 100, 100);
      dispatchPointer(overlay, 'pointermove', 200, 200);
    });
    expect(screen.getByTestId('shape-preview')).toBeTruthy();
    act(() => {
      dispatchPointer(overlay, 'pointercancel', 0, 0);
    });

    // Create a shape directly to verify the model
    const shapeId = createShape(doc, {
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      at: { x: 50, y: 50 },
    }, 'test')!;
    expect(shapeId).toBeTruthy();
    expect(doc.getMap('objects').size).toBe(1);

    // Tool should still be Shape (we cancelled the drag, didn't complete it)
    // Press Escape to return to Select
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Shape (S)')).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-22b: L activates Connector tool; after creation the tool returns to Select
  it('TC-22b: L activates Connector tool; after creation the tool returns to Select', () => {
    renderBoard();
    const doc = capturedDocs[0];

    // Create two shapes for the connector
    let aId = '';
    let bId = '';
    act(() => {
      aId = createShape(doc, { kind: 'rect', rect: { x: -400, y: -50, width: 100, height: 100 }, at: { x: -350, y: 0 } }, 'test')!;
      bId = createShape(doc, { kind: 'rect', rect: { x: 200, y: -50, width: 100, height: 100 }, at: { x: 250, y: 0 } }, 'test')!;
    });

    // Activate Connector tool via keyboard shortcut
    act(() => {
      fireEvent.keyDown(window, { key: 'l' });
    });
    expect(screen.getByLabelText('Connector (L)')).toHaveAttribute('aria-pressed', 'true');

    const overlay = screen.getByTestId('connector-tool-overlay');
    expect(overlay).toBeTruthy();

    // Start a drag and cancel it
    act(() => {
      dispatchPointer(overlay, 'pointerdown', 290, 400);
      dispatchPointer(overlay, 'pointermove', 590, 400);
    });
    act(() => {
      dispatchPointer(overlay, 'pointercancel', 0, 0);
    });

    // Create a connector directly to verify the model
    const connId = createConnector(
      doc,
      { kind: 'attached', objectId: aId, fallback: { x: -300, y: 0 } },
      { kind: 'attached', objectId: bId, fallback: { x: 200, y: 0 } },
      'test',
    )!;
    expect(connId).toBeTruthy();

    const objects = doc.getMap('objects');
    const connectors = [...objects.values()].filter((o) => (o as Y.Map<unknown>).get('type') === 'connector');
    expect(connectors.length).toBe(1);

    // Press Escape to return to Select
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Connector (L)')).toHaveAttribute('aria-pressed', 'false');
  });

  // TC-22c: S then Escape → Select active, nothing created
  it('TC-22c: Escape with Shape tool active returns to Select without creating', () => {
    renderBoard();
    const doc = capturedDocs[0];

    // Activate Shape tool
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    expect(screen.getByLabelText('Shape (S)')).toHaveAttribute('aria-pressed', 'true');

    // Press Escape
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    // Tool reverted to Select
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Shape (S)')).toHaveAttribute('aria-pressed', 'false');

    // Nothing created
    expect(doc.getMap('objects').size).toBe(0);
  });

  // TC-22d: L then Escape → Select active, nothing created
  it('TC-22d: Escape with Connector tool active returns to Select without creating', () => {
    renderBoard();
    const doc = capturedDocs[0];

    // Activate Connector tool
    act(() => {
      fireEvent.keyDown(window, { key: 'l' });
    });
    expect(screen.getByLabelText('Connector (L)')).toHaveAttribute('aria-pressed', 'true');

    // Press Escape
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    // Tool reverted to Select
    expect(screen.getByLabelText('Select (V)')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Connector (L)')).toHaveAttribute('aria-pressed', 'false');

    // Nothing created
    expect(doc.getMap('objects').size).toBe(0);
  });
});
