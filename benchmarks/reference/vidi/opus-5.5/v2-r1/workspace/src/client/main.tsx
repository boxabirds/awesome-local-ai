import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, boardIdFromLocation } from './App';
import { installTestHooks } from './canvas/testHooks';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App boardId={boardIdFromLocation()} />
  </StrictMode>,
);

if (import.meta.env.MODE === 'test') installTestHooks({ unmount: () => root.unmount() });
