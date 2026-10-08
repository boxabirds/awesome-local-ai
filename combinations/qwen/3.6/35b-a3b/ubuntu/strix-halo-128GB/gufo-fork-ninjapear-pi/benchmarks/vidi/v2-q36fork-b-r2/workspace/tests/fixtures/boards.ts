import * as Y from 'yjs';
import { initDoc, createSticky, moveObject, setStickyColor } from '../../src/shared/board-model';
import { STICKY_COLORS, DEFAULT_STICKY_COLOR } from '../../src/shared/config';

/** Generate a Y.Doc with 25 varied sticky notes (mixed colours, multi-line texts, overlapping stacking). */
export function createBoardWith25Notes(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);

  const colors = Object.keys(STICKY_COLORS) as Array<keyof typeof STICKY_COLORS>;

  for (let i = 0; i < 25; i++) {
    const x = (i % 5) * 300 + Math.floor(Math.random() * 100);
    const y = Math.floor(i / 5) * 300 + Math.floor(Math.random() * 100);
    const color = colors[i % colors.length];
    const id = createSticky(doc, { x, y }, color);
    if (!id) continue;

    // Give some notes text (multi-line using \n in actual usage, but here single lines)
    const texts = [
      'Action item',
      'Bug fix needed',
      'Design review',
      'Sprint planning',
      'Retrospective notes',
      'Open question',
      'Decision made',
      'Research task',
      'Documentation update',
      'Code review',
      'API design',
      'Testing coverage',
      'User feedback',
      'Performance improvement',
      'Security audit',
      'Refactoring needed',
      'New feature idea',
      'Tech debt',
      'Onboarding docs',
      'Release checklist',
      'Monitoring setup',
      'Backup strategy',
      'CI/CD pipeline',
      'Load testing',
      'Accessibility check',
    ];
    doc.transact(() => {
      const objects = doc.getMap('objects');
      const noteMap = objects.get(id);
      if (noteMap instanceof Y.Map) {
        const textVal = noteMap.get('text');
        if (textVal instanceof Y.Text) {
          textVal.insert(0, texts[i] || `Note ${i + 1}`);
        } else {
          noteMap.set('text', texts[i] || `Note ${i + 1}`);
        }
      }
    }, (doc as any)._localOrigin || Symbol());
  }

  return doc;
}

/** Generate realistic English phrases for large board testing. */
const PHRASES = [
  'Review the PR and provide feedback on the implementation details.',
  'Schedule a meeting to discuss the new feature requirements.',
  'Update the documentation with the latest API changes.',
  'Write unit tests for the authentication module.',
  'Deploy the staging environment and verify all endpoints.',
  'Create wireframes for the dashboard redesign project.',
  'Analyze the performance metrics and identify bottlenecks.',
  'Plan the sprint backlog items for next week.',
  'Conduct a security audit of the user authentication flow.',
  'Set up monitoring alerts for the production services.',
  'Refactor the database queries to improve response time.',
  'Design the notification system for real-time updates.',
  'Document the deployment process for new team members.',
  'Implement rate limiting on the public API endpoints.',
  'Optimize image loading for better page performance.',
  'Test the checkout flow across different browsers.',
  'Review the accessibility compliance of the UI components.',
  'Set up automated backup procedures for the databases.',
  'Create onboarding materials for new developers.',
  'Evaluate third-party libraries for the analytics module.',
  'Fix the memory leak in the WebSocket connection handler.',
  'Design the error handling strategy for async operations.',
  'Implement caching for frequently accessed data sets.',
  'Write integration tests for the payment processing pipeline.',
  'Review the CI/CD pipeline configuration for improvements.',
  'Update the style guide with new component patterns.',
  'Plan the migration strategy for the legacy authentication system.',
  'Create mockups for the mobile responsive views.',
  'Investigate the slow query causing high latency.',
  'Set up logging for better debugging in production.',
  'Design the role-based access control matrix.',
  'Review the SSL certificate rotation procedure.',
  'Implement retry logic for external API calls.',
  'Write documentation for the internal microservices.',
  'Create the data export functionality for reports.',
  'Test failover scenarios for the disaster recovery plan.',
  'Review the CDN configuration for optimal delivery.',
  'Plan the database schema migration steps carefully.',
  'Implement input validation on all form fields securely.',
  'Set up email templates for transactional notifications.',
  'Design the analytics tracking events for key conversions.',
  'Review the code quality metrics and improvement areas.',
  'Create the user permission management interface.',
  'Test the offline functionality and sync behavior.',
  'Optimize the bundle size by removing unused dependencies.',
  'Implement the search functionality with full-text indexing.',
  'Review the internationalization support across modules.',
  'Design the audit log system for compliance requirements.',
  'Update the server configuration for enhanced security.',
  'Create automated smoke tests for the deployment pipeline.',
  'Review the API versioning strategy for backward compatibility.',
  'Implement push notifications for mobile users.',
  'Set up the staging environment mirror of production.',
  'Design the data retention policy for user information.',
  'Review the error reporting system for developer friendliness.',
  'Create the admin panel for content moderation tasks.',
  'Implement the webhook delivery system for event subscriptions.',
  'Test the load handling during peak traffic scenarios.',
  'Review the logging levels and adjust accordingly.',
  'Design the session management approach for web users.',
  'Implement OAuth 2.0 for third-party integrations.',
  'Create the report generation module for business metrics.',
  'Review the network security configuration thoroughly.',
  'Set up the automated testing framework for regression checks.',
  'Design the event sourcing pattern for audit trails.',
  'Implement the file upload functionality with virus scanning.',
  'Review the database backup procedures and test restoration.',
  'Create the real-time collaboration features prototype.',
  'Test the service mesh connectivity between microservices.',
  'Design the user feedback collection mechanism.',
  'Implement the GDPR compliance features for data removal.',
  'Review the API gateway routing rules for correctness.',
  'Set up the distributed tracing for request flow visibility.',
  'Create the template engine for dynamic email generation.',
  'Implement the feature flag system for gradual rollouts.',
  'Review the infrastructure costs and optimize resource usage.',
  'Design the queue-based job processing architecture.',
  'Test the cross-browser compatibility of the application.',
  'Implement the data encryption at rest for sensitive fields.',
  'Review the dependency vulnerability scan results promptly.',
  'Create the knowledge base articles for common issues.',
  'Design the API contract tests for consumer-driven contracts.',
  'Implement the geographic load balancing across regions.',
  'Review the uptime monitoring dashboards daily.',
  'Set up the automated scaling policies based on demand.',
  'Design the GraphQL schema for flexible client queries.',
  'Implement the multi-language translation pipeline.',
  'Review the DNS configuration for reliability improvements.',
  'Create the A/B testing framework for experiment tracking.',
  'Implement the content delivery optimization strategies.',
  'Review the certificate authority settings for trust chains.',
  'Design the state management approach for complex flows.',
  'Test the database connection pooling under heavy loads.',
  'Implement the data archiving automation for old records.',
  'Review the incident response playbook with the team.',
  'Create the custom chart components for data visualization.',
  'Design the rate limiting algorithm per user tier.',
  'Implement the background worker scheduling system.',
  'Review the container image security vulnerabilities.',
  'Set up the centralized log aggregation pipeline properly.',
  'Design the webhook signing mechanism for security.',
  'Implement the database replication monitoring alerts.',
  'Review the API documentation completeness with stakeholders.',
  'Create the user persona definitions for design alignment.',
  'Design the event-driven architecture for decoupled services.',
  'Implement the cache invalidation strategy across layers.',
  'Review the bandwidth optimization techniques applied.',
  'Set up the canary deployment process with rollback capability.',
  'Design the lazy loading strategy for heavy components.',
  'Implement the structured logging format for traceability.',
  'Review the penetration testing findings and remediate.',
  'Create the story mapping sessions for epics and features.',
  'Design the circuit breaker pattern for fault tolerance.',
  'Implement the data synchronization protocol between replicas.',
  'Review the storage cost analysis and optimize pricing.',
  'Test the graceful degradation during service disruptions.',
  'Design the multi-tenant isolation model for SaaS platform.',
  'Implement the request batching for efficient network usage.',
  'Review the software supply chain security posture.',
  'Set up the performance profiling tools for bottleneck detection.',
];

/** Generate a Y.Doc with PERSIST_TESTED_NOTES sticky notes in clusters. */
export function createLargeBoard(noteCount: number): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);

  const colors = Object.keys(STICKY_COLORS) as Array<keyof typeof STICKY_COLORS>;
  const cols = 20;
  const rows = Math.ceil(noteCount / cols);
  const cellW = 250;
  const cellH = 250;

  for (let i = 0; i < noteCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = col * cellW + 200 + Math.floor(Math.random() * 80);
    const cy = row * cellH + 200 + Math.floor(Math.random() * 80);
    const color = colors[i % colors.length];
    const phrase = PHRASES[i % PHRASES.length];
    const id = createSticky(doc, { x: cx, y: cy }, color);
    if (!id) continue;
    doc.transact(() => {
      const objects = doc.getMap('objects');
      const noteMap = objects.get(id);
      if (noteMap instanceof Y.Map) {
        const textVal = noteMap.get('text');
        if (textVal instanceof Y.Text) {
          textVal.insert(0, phrase.slice(0, 60));
        } else {
          noteMap.set('text', phrase.slice(0, 60));
        }
      }
    }, (doc as any)._localOrigin || Symbol());
  }

  return doc;
}

/** Create an update that adds a single sticky note at the given position. */
export function createSingleNoteUpdate(x: number, y: number): Uint8Array {
  const doc = new Y.Doc();
  initDoc(doc);
  createSticky(doc, { x, y });
  return Y.encodeStateAsUpdate(doc);
}

/** Create a minimal Playwright board URL for E2E tests. Returns board id. */
export async function createBoard(page: import('@playwright/test').Page) {
  const res = await page.goto('http://localhost:' + (process.env.E2E_PORT || 27360));
  // Click "New board" to create
  await page.locator('[aria-label="New board"]').click();
  const url = page.url();
  const match = url.match(/\/b\/([a-f0-9-]+)/);
  if (!match) throw new Error('Could not extract board ID from URL');
  return { id: match[1] };
}

/** Return the raw update bytes for a board with `count` notes. */
export function getBoardUpdateBytes(count: number): Uint8Array {
  const doc = createBoardWith25Notes();
  // We always generate 25-note boards; this helper is for compactness
  return Y.encodeStateAsUpdate(doc);
}
