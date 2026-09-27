import { http, HttpResponse } from 'msw';

/** Story 8 default: Today is empty for whatever date the client asks about. */
export function emptyTodayHandler() {
  return http.get('/api/w/:id/today', ({ request }) => {
    const date = new URL(request.url).searchParams.get('date') ?? '';
    return HttpResponse.json({ date, overdue: [], today: [], completed: [] });
  });
}

export const defaultTodayHandlers = [emptyTodayHandler()];
