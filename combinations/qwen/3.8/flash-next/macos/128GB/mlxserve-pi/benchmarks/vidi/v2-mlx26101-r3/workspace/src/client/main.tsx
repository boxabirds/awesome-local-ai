import { StrictMode } from 'react';
import { createRoot, type Root as ReactRoot } from 'react-dom/client';
import { Root } from './Root';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root element is missing from index.html');
}

/**
 * The entry point: one root, one render, and no routing of its own.
 *
 * Story 5 is the reason this file says nothing about boards any more. Until it, the address bar
 * was a suggestion the client acted on - arriving at `/` made a board up locally and rewrote the
 * address to match, which worked perfectly for as long as a board was a thing one tab had. A board
 * is now a thing the service makes and keeps, which means the address bar arrives with a question
 * in it rather than an instruction, and the answering lives in `Root` and the pages it picks.
 *
 * `App` stayed where it was - the board itself - because a board is the same whether the tab came
 * to it from a link, from the home page or from a component test with a document of its own.
 */
const root: ReactRoot = createRoot(container);

root.render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
