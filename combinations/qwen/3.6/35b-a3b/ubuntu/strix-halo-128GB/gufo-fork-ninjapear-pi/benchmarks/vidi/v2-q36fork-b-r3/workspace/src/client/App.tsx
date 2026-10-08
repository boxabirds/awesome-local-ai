import React, { useState, useEffect, useCallback } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { zoomPercent, canZoomIn, canZoomOut } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { NoteToolbar } from './objects/NoteToolbar';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject, setStickyColor } from '@shared/board-model';
import { screenToWorld } from './canvas/camera';
import type { StickySnapshot } from '@shared/board-model';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { getState as getGlobalState } from './sync/connectBoard';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { Route, subscribe, parseRoute } from './router';

declare global {
  interface Window {
    __getCamera?: () => ReturnType<typeof useCamera>['camera'] | null;
    __getStickyNotes?: () => readonly StickySnapshot[];
  }
}

export function AppRouter() {
  return <App />;
}

export function App() {
  const [route, setRoute] = useState<Route>(parseRoute());

  useEffect(() => {
    const unsub = subscribe((r: Route) => setRoute(r));
    return unsub;
  }, []);

  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
    default:
      return <HomePage />;
  }
}
