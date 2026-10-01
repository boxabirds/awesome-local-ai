import * as Y from 'yjs';
import { createSticky } from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES } from '../../src/shared/config';
import type { StickyColor } from '../../src/shared/config';

/**
 * Generate a 25-note retro board with mixed colours, multi-line texts, and overlapping stacking.
 */
export function seed25Notes(doc: Y.Doc): void {
  const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
  const texts = [
    'What went well this sprint\nShip the feature',
    'Blockers\nCI flaky tests',
    'Ideas\nTry pair programming\nMore mob reviews',
    'Action items\nFix deploy script',
    'Shout-outs\nAlice for great docs\nBob for mentoring',
    'Frustrations\nToo many meetings',
    'Wins\nZero downtime deploy',
    'Metrics\nVelocity up 15%',
    'Next sprint\nRefactor auth module',
    'Tech debt\nUpgrade dependencies',
    'Process\nStandup is too long',
    'Tools\nNew IDE helped a lot',
    'Communication\nAsync updates working well',
    'Learning\nNew team member onboarding',
    'Customer feedback\nFeature request #42',
    'Performance\nPage load improved',
    'Quality\nTest coverage 85%',
    'Documentation\nREADME needs update',
    'Infrastructure\nMigration going smoothly',
    'Morale\nTeam feels positive',
    'Goals\nShip v2 by end of month',
    'Risks\nKey person dependency',
    'Appreciation\nQA caught critical bug',
    'Improvements\nBetter sprint planning',
    'Thank you\nGreat teamwork everyone!',
  ];

  for (let i = 0; i < 25; i++) {
    const x = (i % 5) * 250;
    const y = Math.floor(i / 5) * 250;
    const color = colors[i % colors.length]!;
    const id = createSticky(doc, { x, y }, color);
    if (id && texts[i]) {
      const objMap = (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).get(id)!;
      const text = objMap.get('text') as Y.Text;
      text.insert(0, texts[i]!);
    }
  }
}

/** Realistic English phrases for large board testing. */
const PHRASES: string[] = [
  'Consider the implications of changing the database schema at this stage of development',
  'The authentication module needs to support OAuth 2.0 and SAML protocols for enterprise customers',
  'Performance benchmarks show a 40% improvement after optimizing the query planner',
  'Team sync scheduled for Thursday to discuss the roadmap and prioritize backlog items',
  'Customer feedback indicates strong demand for real-time collaboration features',
  'Technical debt in the legacy codebase requires careful refactoring to avoid regressions',
  'The deployment pipeline needs better rollback mechanisms for zero-downtime releases',
  'Security audit revealed several vulnerabilities in the third-party dependency chain',
  'Mobile responsive design requires rethinking the component architecture from scratch',
  'Load testing revealed memory leaks in the WebSocket connection handler under high concurrency',
  'The onboarding flow conversion rate improved by 25% after the redesign',
  'Data migration strategy should include rollback procedures and validation checkpoints',
  'Cross-browser compatibility issues with the canvas rendering in Safari on iOS devices',
  'The API rate limiting implementation needs to account for burst traffic patterns',
  'Automated testing coverage dropped below the threshold due to new untested code paths',
  'User research sessions revealed confusion about the navigation hierarchy and information architecture',
  'Infrastructure costs can be reduced by implementing intelligent caching at the edge',
  'The notification system needs debouncing to prevent alert fatigue during incident response',
  'Accessibility audit found insufficient contrast ratios on several interactive elements',
  'Database connection pooling reduced latency by eliminating repeated TCP handshakes',
  'Feature flag system enables gradual rollouts and instant rollback without redeployment',
  'Search relevance improved significantly after implementing semantic vector embeddings',
  'The build system cache invalidation logic needs review for monorepo package changes',
  'Event-driven architecture decouples services but adds complexity to debugging workflows',
  'The design system component library reduces duplication and ensures visual consistency',
];

/**
 * Generate a board with PERSIST_TESTED_NOTES notes with realistic English phrases laid out in clusters.
 */
export function seedLargeBoard(doc: Y.Doc): void {
  const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
  const clusterSize = 5;
  const clusterSpacing = 1500;
  const noteSpacing = 260;

  for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
    const cluster = Math.floor(i / clusterSize);
    const inCluster = i % clusterSize;
    const clusterX = (cluster % 20) * clusterSpacing;
    const clusterY = Math.floor(cluster / 20) * clusterSpacing;
    const x = clusterX + (inCluster % 3) * noteSpacing + Math.floor(Math.random() * 30);
    const y = clusterY + Math.floor(inCluster / 3) * noteSpacing + Math.floor(Math.random() * 30);
    const color = colors[i % colors.length]!;
    const id = createSticky(doc, { x, y }, color);
    if (id) {
      const objMap = (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).get(id)!;
      const text = objMap.get('text') as Y.Text;
      // Pick a phrase and vary it slightly
      const phrase = PHRASES[i % PHRASES.length]!;
      const suffix = i >= PHRASES.length ? ` (${i})` : '';
      text.insert(0, phrase + suffix);
    }
  }
}

/**
 * Create a damaged (truncated) update by taking a valid update and removing last 10 bytes.
 */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.length - 10));
}

/**
 * Create random bytes of the same length as the given update.
 */
export function randomBytesOfLength(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}
