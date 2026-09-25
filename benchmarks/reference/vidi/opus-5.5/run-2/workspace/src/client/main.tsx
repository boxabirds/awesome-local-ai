import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Routes } from './App';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <Routes />
  </StrictMode>,
);
