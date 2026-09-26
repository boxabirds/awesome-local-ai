import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Home } from './Home.tsx';

it('shows the Todoodle heading', () => {
  render(<Home />);
  expect(screen.getByRole('heading', { level: 1, name: 'Todoodle' })).toBeInTheDocument();
});
