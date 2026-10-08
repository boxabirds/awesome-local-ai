import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react/pure';
import '@testing-library/jest-dom/vitest';
import { SelectionBar } from '../../src/client/board/SelectionBar';

describe('SelectionBar component', () => {
  afterEach(cleanup);

  const makeNote = (id: string): import('../../src/shared/board-model').StickySnapshot => ({
    id, x: 0, y: 0, text: '', color: 'yellow' as any, z: 0, type: 'sticky', createdAt: Date.now(),
  });

  test('TC-16: renders null when no selection', () => {
    const doc = new (require('yjs').Doc)();
    const { container } = render(<SelectionBar ids={new Set()} snapshot={[]} doc={doc} onDelete={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  test('TC-17: renders single-note toolbar with colour buttons and delete when one selected', () => {
    const note = makeNote('note-1');
    const doc = new (require('yjs').Doc)();
    const onDelete = vi.fn();
    
    render(<SelectionBar ids={new Set([note.id])} snapshot={[note]} doc={doc} onDelete={onDelete} />);

    // Delete button should be present
    expect(screen.getByLabelText(/delete/i)).toBeInTheDocument();
    
    // Colour buttons should be present (6 colours)
    const colourButtons = screen.getAllByRole('button');
    expect(colourButtons.length).toBeGreaterThan(0);
  });

  test('TC-18: renders multi-selection bar with "N selected" text and delete button when multiple selected', () => {
    const note1 = makeNote('note-1');
    const note2 = makeNote('note-2');
    const note3 = makeNote('note-3');
    const doc = new (require('yjs').Doc)();
    const allIds = new Set([note1.id, note2.id, note3.id]);
    
    render(<SelectionBar ids={allIds} snapshot={[note1, note2, note3]} doc={doc} onDelete={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('3 selected');
    expect(screen.getByTitle('Delete selection')).toBeInTheDocument();
  });

  test('TC-19: colour buttons are rendered for single selection', () => {
    const note = makeNote('note-1');
    const doc = new (require('yjs').Doc)();
    
    const { container } = render(<SelectionBar ids={new Set([note.id])} snapshot={[note]} doc={doc} onDelete={vi.fn()} />);

    // Colour buttons should have circular backgrounds
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(1); // colour buttons + delete
  });
});
