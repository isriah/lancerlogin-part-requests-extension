import { TOKEN_NAMES, brandTokens, isHexColor } from './brand';
import type { Theme, Tokens } from './brand';
import type { SettingsView } from './types';

/** Read synchronously by public/appearance-boot.js. The worker's storage is the real record, and this is only a copy of it. */
export const APPEARANCE_KEY = 'part-requests-appearance';
const DEFAULT_NAME = 'LancerLogin';

export const currentTheme = (): Theme => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
function applyTokens(tokens: Tokens | null): void {
  const root = document.documentElement;
  // With no team colors, the stylesheet's LancerLogin defaults apply.
  for (const name of TOKEN_NAMES) { if (tokens) root.style.setProperty(name, tokens[name]); else root.style.removeProperty(name); }
}
/** Applies what the worker reported: the theme, the team's colors and name, as CSS custom properties and plain text only. */
export function applyAppearance(view: Pick<SettingsView, 'brand' | 'theme'>): void {
  const theme: Theme = view.theme === 'light' ? 'light' : 'dark';
  const brand = view.brand && isHexColor(view.brand.primary) && isHexColor(view.brand.secondary) ? view.brand : undefined;
  const tokens = brand ? { dark: brandTokens(brand.primary, brand.secondary, 'dark'), light: brandTokens(brand.primary, brand.secondary, 'light') } : undefined;
  document.documentElement.setAttribute('data-theme', theme);
  applyTokens(tokens ? tokens[theme] : null);
  const name = brand?.organizationName || DEFAULT_NAME;
  const heading = document.getElementById('brand-name');
  if (heading) heading.textContent = name;
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ theme, ...(tokens ? { tokens, name } : {}) })); }
  catch { /* Only the next page's first paint depends on this copy. */ }
}
