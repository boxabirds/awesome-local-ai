import * as Y from 'yjs';
import { createSticky, moveObject, initDoc } from '@shared/board-model';
import { STICKY_COLORS, type StickyColor } from '@shared/config';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

const PHRASES = [
  'What if we launched next quarter instead?',
  'The user flow feels too long at this step',
  'Can we simplify the onboarding by removing this form?',
  'I think the pricing page needs more social proof',
  'Let us test this with five real customers first',
  'The mobile layout breaks on smaller screens here',
  'We should add a dark mode option for accessibility',
  'This feature request comes up in every call',
  'The API response time is too slow for production',
  'Nobody uses the export feature according to analytics',
  'We need to fix the memory leak in the dashboard',
  'The search results are not ranked correctly',
  'Customers keep asking for team sharing capabilities',
  'The notification system sends too many emails',
  'We should consider a paywall for premium features',
  'The onboarding drop-off rate is unacceptably high',
  'This integration with Slack would save hours weekly',
  'The error messages are confusing and not actionable',
  'We need better documentation for the public API',
  'The landing page conversion rate dropped last month',
  'Accessibility audit found twelve critical issues',
  'The caching strategy is not working as intended',
  'Users expect instant feedback when they type',
  'The mobile app crashes on Android version 14',
  'We should A/B test two different checkout flows',
  'The support ticket volume doubled this quarter',
  'Data migration from the old system is risky',
  'The real-time collaboration has ghost cursors',
  'Feature flags should be cleaned up after launch',
  'The database indexing strategy needs review',
  'We are over-engineering the permission system',
  'The email templates look broken in Outlook',
  'Load testing shows the server cannot handle 10k users',
  'The dark theme contrast ratio fails WCAG AA',
  'We should migrate to a microservices architecture',
  'The analytics dashboard is too slow to load',
  'Users report that the autocomplete is too aggressive',
  'The WebSocket connection drops every thirty seconds',
  'We need rate limiting on the public endpoints',
  'The mobile push notifications are not delivered reliably',
  'The search index rebuild takes too long at night',
];

export function createRetroBoard(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);

  // 25 notes with mixed colours, multi-line texts, overlapping stacking
  for (let i = 0; i < 25; i++) {
    const x = (i % 5) * 250 + Math.floor(Math.random() * 50);
    const y = Math.floor(i / 5) * 250 + Math.floor(Math.random() * 50);
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);
    if (id && i % 3 === 0) {
      // Add multi-line text to some notes
      const obj = doc.getMap('objects').get(id) as Y.Map<any>;
      const textObj = obj.get('text');
      if (textObj instanceof Y.Text) {
        textObj.insert(0, `Note ${i + 1}\nSecond line\nThird line`);
      }
    }
    if (id && i % 4 === 0) {
      // Move some notes to create overlaps
      moveObject(doc, id, x + 30, y + 30);
    }
  }

  return doc;
}

export function createLargeBoard(noteCount: number): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);

  for (let i = 0; i < noteCount; i++) {
    // Layout in clusters of 10x10
    const clusterX = Math.floor(i / 100) * 1500;
    const clusterY = Math.floor((i % 100) / 10) * 250;
    const x = clusterX + (i % 10) * 220 + Math.floor(Math.random() * 20);
    const y = clusterY + Math.floor(Math.random() * 20);
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);
    if (id) {
      const obj = doc.getMap('objects').get(id) as Y.Map<any>;
      const textObj = obj.get('text');
      if (textObj instanceof Y.Text) {
        const phrase = PHRASES[i % PHRASES.length];
        // Vary text length between 10-300 chars
        const repetition = Math.max(1, Math.floor((10 + (i % 291)) / phrase.length));
        textObj.insert(0, phrase.repeat(Math.min(repetition, 10)).slice(0, 10 + (i % 291)));
      }
    }
  }

  return doc;
}

export function getDocUpdate(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

export function createDamagedUpdate(doc: Y.Doc): Uint8Array {
  const update = Y.encodeStateAsUpdate(doc);
  // Truncate: remove last 10 bytes
  return update.subarray(0, update.length - 10);
}

export function createRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}
