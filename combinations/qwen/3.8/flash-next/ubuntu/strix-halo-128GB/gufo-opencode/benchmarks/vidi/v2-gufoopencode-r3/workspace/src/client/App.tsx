import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

// The app is now a router host: '/' shows the home page (create a board),
// '/b/:id' opens a board (with an existence check), anything else is not
// found. Story 5 removed the old client-side board creation on '/'.
export function App() {
  const route = useRoute();
  if (route.name === 'board') return <BoardPage id={route.id} />;
  if (route.name === 'not_found') return <NotFoundPage />;
  return <HomePage />;
}
