/**
 * The entry point: mount the page this address names, and nothing else.
 *
 * Story 3 put a redirect here — `/` invented a board id, wrote it into the address bar
 * and opened it — because that was the only way to get an address to share. Story 5 moves
 * that decision where it belongs: `/` is the home page, a board comes from the server that
 * makes it, and this file stops knowing anything about addresses.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

createRoot(container).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
