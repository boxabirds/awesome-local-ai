import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// Nothing is done to the address before the first render. Until story 4 the app put a
// board address in the bar if it did not have one; that made a first visit a board,
// and story 5 needs a first visit that is the home page. Whatever the address is, the
// router renders the page it asks for (see `App`).
const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
createRoot(container).render(<App />);
