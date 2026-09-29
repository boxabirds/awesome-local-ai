import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');
createRoot(rootElement).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
