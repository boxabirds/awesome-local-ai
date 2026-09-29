import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './App';
import { installTestHooks } from './canvas/testHooks';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

if (import.meta.env.MODE === 'test') installTestHooks({ unmount: () => root.unmount() });
