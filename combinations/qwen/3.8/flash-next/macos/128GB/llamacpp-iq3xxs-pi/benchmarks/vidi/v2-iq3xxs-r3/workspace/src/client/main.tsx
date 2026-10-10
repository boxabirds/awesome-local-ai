import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('missing #root container');
}

createRoot(container).render(<App />);
