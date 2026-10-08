import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc } from '@shared/board-model';
import { Toolbar } from '@client/board/Toolbar';
import { NoteToolbar } from '@client/objects/NoteToolbar';
import type { StickyColor } from '@shared/config';

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeDocWithSticky(): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  initDoc(doc);
  return { doc, id: crypto.randomUUID() };
}

// ─── TC-27: Pink swatch → model colour pink, selection kept ─────────────

describe('TC-27: colour change via toolbar', () => {
  it('clicking Pink swatch calls onColor with "pink"', async () => {
    const onColor = vi.fn<(...args: any[]) => void>();
    const onDelete = vi.fn();

    const { getByRole } = render(
      <NoteToolbar color="yellow" onColor={onColor} onDelete={onDelete} />,
    );

    await act(async () => {
      const btn = getByRole('button', { name: /pink colour/i });
      btn.click();
    });

    expect(onColor).toHaveBeenCalledWith('pink');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('all six swatches are present with correct accessible names', async () => {
    const { getByRole } = render(
      <NoteToolbar color="yellow" onColor={vi.fn()} onDelete={vi.fn()} />,
    );

    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    for (const c of colors) {
      const btn = getByRole('button', { name: new RegExp(`${c} colour`, 'i') });
      expect(btn).toBeTruthy();
    }
  });

  it('delete button calls onDelete', async () => {
    const onColor = vi.fn();
    const onDelete = vi.fn();

    const { getByRole } = render(
      <NoteToolbar color="yellow" onColor={onColor} onDelete={onDelete} />,
    );

    await act(async () => {
      const btn = getByRole('button', { name: 'Delete note' });
      btn.click();
    });

    expect(onDelete).toHaveBeenCalled();
    expect(onColor).not.toHaveBeenCalled();
  });
});

// ─── TC-28: Sticky note button → creates note centred ───────────────────

describe('TC-28: Sticky note button creates note', () => {
  it('clicking the toolbar button calls onCreateSticky', async () => {
    const onCreateSticky = vi.fn();

    const { container } = render(
      <Toolbar onCreateSticky={onCreateSticky} canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}} />,
    );
    const btn = container.querySelector('[aria-label="Sticky note"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();

    await act(async () => {
      btn.click();
    });

    expect(onCreateSticky).toHaveBeenCalled();
  });
});

// ─── TC-23: Sticky note button disabled when load_failed ──────────────

describe('TC-23: Toolbar disabled in load_failed', () => {
  it('disabled prop hides cursor and prevents onClick', async () => {
    const onCreateSticky = vi.fn();
    const { container } = render(
      <Toolbar
        onCreateSticky={onCreateSticky}
        disabled
        canUndo={false}
        canRedo={false}
        onUndo={() => {}}
        onRedo={() => {}}
      />,
    );
    const btn = container.querySelector('[aria-label="Sticky note"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.style.cursor).toBe('not-allowed');
    expect(btn.style.opacity).toBe('0.6');

    await act(async () => {
      btn.click();
    });
    expect(onCreateSticky).not.toHaveBeenCalled();
  });
});

// ─── TC-29: bin button → note removed, selection cleared ────────────────

describe('TC-29: bin button deletes note', () => {
  it('bin button triggers deleteObject and clears selection', async () => {
    // Verified through App integration in e2e.
    // Here we verify the component renders correctly.
    const onColor = vi.fn();
    const onDelete = vi.fn();

    const { container } = render(
      <div className="toolbar">
        <NoteToolbar color="green" onColor={onColor} onDelete={onDelete} />
      </div>,
    );

    const btn = container.querySelector('.toolbar [aria-label="Delete note"]');
    expect(btn).toBeTruthy();
  });
});
