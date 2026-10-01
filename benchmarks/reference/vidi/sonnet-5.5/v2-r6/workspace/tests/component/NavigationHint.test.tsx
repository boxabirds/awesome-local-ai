import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';

const HINT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

describe('NavigationHint', () => {
  it('shows the hint text when visible', () => {
    render(<NavigationHint visible />);
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('renders nothing when not visible', () => {
    const { container } = render(<NavigationHint visible={false} />);
    expect(container.innerHTML).toBe('');
  });
});
