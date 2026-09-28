import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  NavigationHint,
  NAVIGATION_HINT_TEXT,
} from '../../src/client/canvas/NavigationHint';

afterEach(cleanup);

describe('NavigationHint (presentational)', () => {
  it('renders the exact hint text when visible', () => {
    render(<NavigationHint visible />);
    const hint = screen.getByTestId('navigation-hint');
    expect(hint).toHaveTextContent(
      'Drag to move around \u00B7 Ctrl/Cmd + scroll or pinch to zoom',
    );
    expect(hint.textContent).toBe(NAVIGATION_HINT_TEXT);
  });

  it('renders nothing when not visible', () => {
    render(<NavigationHint visible={false} />);
    expect(screen.queryByTestId('navigation-hint')).not.toBeInTheDocument();
  });
});
