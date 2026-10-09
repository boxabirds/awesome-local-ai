import type { JSX } from 'react';
import { navigate } from '../router';
import { HomeLayout, useBoardCreate } from './HomePage';

export function NotFoundPage(): JSX.Element {
  const { state, create } = useBoardCreate();
  return (
    <HomeLayout
      heading="Board not found"
      tagline="Check the link, or ask the person who shared it to send it again."
      state={state}
      onCreate={create}
    >
      <a
        href="/"
        style={{ marginTop: 24, font: '500 14px system-ui, sans-serif', color: '#2563eb' }}
        onClick={(event) => {
          event.preventDefault();
          navigate('/');
        }}
      >
        Go to the home page
      </a>
    </HomeLayout>
  );
}
