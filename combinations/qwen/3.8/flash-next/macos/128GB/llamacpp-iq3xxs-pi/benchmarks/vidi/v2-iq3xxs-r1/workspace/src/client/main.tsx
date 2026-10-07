import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ensureBoardPath } from './board/boardRoute';
import './index.css';

// The URL is the board (PRD live.board_url): `/` becomes `/b/<new id>` before the
// first render, so nothing downstream has to handle a board-less location.
const boardId = ensureBoardPath();

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
createRoot(container).render(<App boardId={boardId} />);
