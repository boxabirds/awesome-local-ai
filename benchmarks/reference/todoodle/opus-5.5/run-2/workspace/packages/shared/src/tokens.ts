/**
 * Theme colour tokens: the single source of colour for every story. apps/web/scripts/build-tokens.ts
 * generates apps/web/src/styles/tokens.css from this file, and the contrast test reads it too.
 */

export const SEMANTIC_TOKENS = [
  'background',
  'foreground',
  'muted',
  'muted-foreground',
  'primary',
  'primary-foreground',
  'destructive',
  'border',
  'ring',
  'warning',
  'warning-surface',
  'success',
] as const;
export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];

export type Theme = 'light' | 'dark';

export const THEME_TOKENS: Record<Theme, Record<SemanticToken, string>> = {
  light: {
    background: '#ffffff',
    foreground: '#171717',
    muted: '#f2f2f3',
    'muted-foreground': '#52525b',
    primary: '#1d4ed8',
    'primary-foreground': '#ffffff',
    destructive: '#b91c1c',
    border: '#8b8b94',
    ring: '#1d4ed8',
    warning: '#92400e',
    'warning-surface': '#fef3c7',
    success: '#15803d',
  },
  dark: {
    background: '#0b0b0c',
    foreground: '#f5f5f5',
    muted: '#26262a',
    'muted-foreground': '#a8a8b0',
    primary: '#60a5fa',
    'primary-foreground': '#0b0b0c',
    destructive: '#f87171',
    border: '#6e6e78',
    ring: '#60a5fa',
    warning: '#fbbf24',
    'warning-surface': '#3a2d0c',
    success: '#4ade80',
  },
};

/** The 12 project colours (story 7 references these tokens as --project-<name>). */
export const PROJECT_COLORS = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

export const PROJECT_COLOR_TOKENS: Record<Theme, Record<ProjectColor, string>> = {
  light: {
    red: '#dc2626',
    orange: '#c2410c',
    amber: '#b45309',
    yellow: '#a16207',
    lime: '#4d7c0f',
    green: '#15803d',
    teal: '#0f766e',
    cyan: '#0e7490',
    blue: '#2563eb',
    indigo: '#4f46e5',
    violet: '#7c3aed',
    pink: '#db2777',
  },
  dark: {
    red: '#f87171',
    orange: '#fb923c',
    amber: '#fbbf24',
    yellow: '#facc15',
    lime: '#a3e635',
    green: '#4ade80',
    teal: '#2dd4bf',
    cyan: '#22d3ee',
    blue: '#60a5fa',
    indigo: '#818cf8',
    violet: '#a78bfa',
    pink: '#f472b6',
  },
};

/** Foreground/background pairs used for text: each must reach 4.5:1 in both themes. */
export const TEXT_PAIRS: ReadonlyArray<readonly [SemanticToken, SemanticToken]> = [
  ['foreground', 'background'],
  ['foreground', 'muted'],
  ['foreground', 'warning-surface'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'],
  ['destructive', 'background'],
  ['warning', 'background'],
  ['success', 'background'],
];

/** UI boundary pairs (borders, focus rings, filled controls): each must reach 3:1 in both themes. */
export const UI_PAIRS: ReadonlyArray<readonly [SemanticToken, SemanticToken]> = [
  ['border', 'background'],
  ['ring', 'background'],
  ['ring', 'muted'],
  ['primary', 'background'],
];
