/**
 * Component test: App in load_failed state blocks editing (TC-23).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Toolbar } from '../../src/client/board/Toolbar';

describe('Toolbar disabled in load_failed (TC-23)', () => {
  it('TC-23: Sticky note button is disabled when disabled prop is true', () => {
    const onCreateSticky = vi.fn();
    render(<Toolbar onCreateSticky={onCreateSticky} disabled={true} />);

    const button = screen.getByRole('button', { name: 'Sticky note (N)' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('TC-23b: Sticky note button is enabled when disabled prop is false', () => {
    const onCreateSticky = vi.fn();
    render(<Toolbar onCreateSticky={onCreateSticky} disabled={false} />);

    const button = screen.getByRole('button', { name: 'Sticky note (N)' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('TC-23c: Sticky note button is enabled when disabled prop is not provided', () => {
    const onCreateSticky = vi.fn();
    render(<Toolbar onCreateSticky={onCreateSticky} />);

    const button = screen.getByRole('button', { name: 'Sticky note (N)' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
