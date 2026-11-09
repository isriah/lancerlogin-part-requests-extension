// Team colors: what counts as a valid answer from the site, and the readable tokens worked out from it. No browser APIs here.
export type Theme = 'dark' | 'light';
/** What the service worker keeps from the site's public status, once it has passed `parseBranding`. */
export interface Brand { primary: string; secondary: string; organizationName: string; checkedAt: number }

/** LancerLogin's released defaults, used until a device is paired. */
export const DEFAULT_PRIMARY = '#b80100';
export const DEFAULT_SECONDARY = '#eeb822';
export const TOKEN_NAMES = ['--primary', '--secondary', '--on-primary', '--on-secondary', '--accent-text', '--primary-edge', '--ui-focus'] as const;
export type Tokens = Record<(typeof TOKEN_NAMES)[number], string>;

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_NAME = 100; // Core's own limit.
// The dashboard's fixed surfaces. Status pills use their own fixed tones and never come from these.
const PAGE = { dark: '#111315', light: '#f3f5f2' }, SURFACE = { dark: '#191c1f', light: '#ffffff' }, SUBTLE = { dark: '#24282d', light: '#eef1ef' }, TEXT = { dark: '#f1f3f4', light: '#16211d' };

export const isHexColor = (value: unknown): value is string => typeof value === 'string' && HEX.test(value);
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
/** Moves a color toward the text color, in steps of 5%, until it reaches the ratio against every background given. */
function reach(color: string, toward: string, backgrounds: string[], minimum: number): string {
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, toward, step / 20);
    if (backgrounds.every(b => contrast(candidate, b) >= minimum)) return candidate;
  }
  return toward;
}
/** White, then the dashboard's dark ink, then black: the first that reaches 4.5:1. White or black always can. */
const onColor = (background: string): string => ['#ffffff', '#111714', '#000000'].find(c => contrast(background, c) >= 4.5)!;
export function brandTokens(primary: string, secondary: string, theme: Theme): Tokens {
  const surface = SURFACE[theme], text = TEXT[theme];
  return {
    '--primary': primary, '--secondary': secondary, '--on-primary': onColor(primary), '--on-secondary': onColor(secondary),
    '--accent-text': reach(primary, text, [surface, SUBTLE[theme]], 4.5),
    '--primary-edge': reach(primary, text, [surface], 3),
    '--ui-focus': reach(mix(primary, '#ffffff', 0.22), text, [surface, PAGE[theme]], 3),
  };
}
/** Every pair the tokens promise, with its minimum. Used by the tests. */
export function contrastReport(primary: string, secondary: string, theme: Theme): { name: string; ratio: number; minimum: number }[] {
  const t = brandTokens(primary, secondary, theme), surface = SURFACE[theme];
  return [
    { name: 'Text on the primary button', ratio: contrast(t['--on-primary'], primary), minimum: 4.5 },
    { name: 'Text on the secondary mark', ratio: contrast(t['--on-secondary'], secondary), minimum: 4.5 },
    { name: 'Link and accent text on a card', ratio: contrast(t['--accent-text'], surface), minimum: 4.5 },
    { name: 'Link and accent text on a subtle surface', ratio: contrast(t['--accent-text'], SUBTLE[theme]), minimum: 4.5 },
    { name: 'Primary edge on a card', ratio: contrast(t['--primary-edge'], surface), minimum: 3 },
    { name: 'Focus ring on a card', ratio: contrast(t['--ui-focus'], surface), minimum: 3 },
    { name: 'Focus ring on the page', ratio: contrast(t['--ui-focus'], PAGE[theme]), minimum: 3 },
  ];
}
/** All or nothing: an answer with anything unexpected in these three fields is treated as no answer, so the last good colors stay. */
export function parseBranding(body: unknown): Omit<Brand, 'checkedAt'> | null {
  const settings = (body as { settings?: unknown } | null)?.settings as { primaryColor?: unknown; secondaryColor?: unknown; organizationName?: unknown } | null | undefined;
  if (!settings || typeof settings !== 'object') return null;
  const { primaryColor, secondaryColor, organizationName } = settings;
  if (!isHexColor(primaryColor) || !isHexColor(secondaryColor) || typeof organizationName !== 'string') return null;
  const name = organizationName.trim();
  // eslint-disable-next-line no-control-regex
  if (!name || name.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return { primary: primaryColor, secondary: secondaryColor, organizationName: name };
}
