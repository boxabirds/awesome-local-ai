import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { NAV_HINT_TEXT } from '../../src/shared/config';

describe('TC-22: NavigationHint visibility', () => {
  it('renders text when visible is true', () => {
    const { getByText } = render(<NavigationHint visible />);
    expect(getByText(NAV_HINT_TEXT)).toBeTruthy();
  });

  it('returns null when visible is false', () => {
    const { container } = render(<NavigationHint visible={false} />);
    expect(container.innerHTML).toBe('');
  });
});
