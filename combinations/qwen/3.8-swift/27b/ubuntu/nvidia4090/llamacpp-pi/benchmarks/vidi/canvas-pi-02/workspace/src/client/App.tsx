// App (story 5): the router. / is the create-board home page, /b/:boardId
// is the board (with existence check + share), and everything else is the
// not-found view. The board UI itself lives in BoardPage.tsx.

import type { ReactElement } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import { Home } from './Home';
import { BoardPage } from './BoardPage';
import { NotFound } from './NotFound';

export default function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/b/:boardId" element={<BoardIdRoute />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/** Reads the route param; BoardPage's existence check handles an id the
 *  server does not know (it answers 404 and the page shows not-found after
 *  its retries). */
function BoardIdRoute(): ReactElement {
  const { boardId } = useParams();
  if (boardId === undefined) return <NotFound />;
  return <BoardPage boardId={boardId} />;
}
