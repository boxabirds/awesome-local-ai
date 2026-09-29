import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
