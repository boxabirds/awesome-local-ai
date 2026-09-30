import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, boardIdFromLocation } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const boardId = boardIdFromLocation();

createRoot(root).render(
  <StrictMode>
    <App key={boardId} boardId={boardId} />
  </StrictMode>,
);
