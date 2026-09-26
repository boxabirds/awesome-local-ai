// Theme colour tokens: the single source of colour for every story. apps/web/scripts/build-tokens.ts
// generates apps/web/src/styles/tokens.css from this file; the contrast tests read it directly.

export type Theme = 'light' | 'dark';

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
  'success',
] as const;
export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];

export const TOKENS: Record<Theme, Record<SemanticToken, string>> = {
  light: {
    background: '#ffffff',
    foreground: '#171717',
    muted: '#f4f4f5',
    'muted-foreground': '#52525b',
    primary: '#1d4ed8',
    'primary-foreground': '#ffffff',
    destructive: '#b91c1c',
    border: '#8a8a93',
    ring: '#2563eb',
    warning: '#a14b05',
    success: '#15803d',
  },
  dark: {
    background: '#0a0a0a',
    foreground: '#fafafa',
    muted: '#262626',
    'muted-foreground': '#a3a3a3',
    primary: '#93c5fd',
    'primary-foreground': '#0a0a0a',
    destructive: '#f87171',
    border: '#6b6b73',
    ring: '#60a5fa',
    warning: '#fbbf24',
    success: '#4ade80',
  },
};

/** The 12 project colours (story 7), each with a light and a dark value that stands out from the background. */
export const PROJECT_COLORS = [
  'red',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'purple',
  'pink',
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

export const PROJECT_COLOR_TOKENS: Record<Theme, Record<ProjectColor, string>> = {
  light: {
    red: '#dc2626',
    orange: '#c2410c',
    amber: '#b45309',
    lime: '#4d7c0f',
    green: '#15803d',
    teal: '#0f766e',
    cyan: '#0e7490',
    blue: '#2563eb',
    indigo: '#4f46e5',
    violet: '#7c3aed',
    purple: '#9333ea',
    pink: '#db2777',
  },
  dark: {
    red: '#f87171',
    orange: '#fb923c',
    amber: '#fbbf24',
    lime: '#a3e635',
    green: '#4ade80',
    teal: '#2dd4bf',
    cyan: '#22d3ee',
    blue: '#60a5fa',
    indigo: '#818cf8',
    violet: '#a78bfa',
    purple: '#c084fc',
    pink: '#f472b6',
  },
};

/** Pairs that carry text: [foreground, background], each must reach 4.5:1. */
export const TEXT_PAIRS: ReadonlyArray<readonly [SemanticToken, SemanticToken]> = [
  ['foreground', 'background'],
  ['foreground', 'muted'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'],
  ['destructive', 'background'],
  ['warning', 'background'],
  ['success', 'background'],
];

/** UI boundaries (borders, focus rings, filled controls) against the page: each must reach 3:1. */
export const UI_PAIRS: ReadonlyArray<readonly [SemanticToken, SemanticToken]> = [
  ['border', 'background'],
  ['ring', 'background'],
  ['ring', 'muted'],
  ['primary', 'background'],
];

/** CSS custom property name for a project colour. */
export function projectColorVar(color: ProjectColor): string {
  return `--project-${color}`;
}
