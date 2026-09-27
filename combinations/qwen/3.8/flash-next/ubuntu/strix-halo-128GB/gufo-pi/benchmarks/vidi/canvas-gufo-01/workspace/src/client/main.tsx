// Entry point. No StrictMode: it double-mounts effects, and y-websocket's
// provider is not designed for a connect/destroy/connect cycle in dev.

import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');
createRoot(container).render(<App />);
