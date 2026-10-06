/**
 * App: renders the router-driven page (Home, Board, or Not Found).
 *
 * Story 5 replaces the story 3 redirect (client-generated board id) with explicit
 * routing: `/` → HomePage, `/b/:id` → BoardPage, anything else → NotFoundPage.
 */
import { CameraProvider } from './canvas/CameraProvider';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  const route = useRoute();

  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return (
        <CameraProvider>
          <BoardPage id={route.id} />
        </CameraProvider>
      );
    case 'not_found':
      return <NotFoundPage />;
  }
}
