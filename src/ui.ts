import { safeUpdateUrl } from './client';
import { isBelowMinimum } from './version';
import type { DeviceOptions, Message } from './types';
export class UiError extends Error {
  constructor(message: string, public code?: string, public details?: unknown) { super(message); }
}
export async function send<T>(message: Message): Promise<T> {
  if (!globalThis.chrome?.runtime?.id) throw new UiError('Load the dist folder as an unpacked Chrome extension to pair and capture products.');
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new UiError(response?.error || 'The extension did not respond. Reopen it to check the saved result.', response?.code, response?.details);
  return response.data;
}
export function el<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
export function choices(select: HTMLSelectElement, values: { id: string; name: string }[], selected = '', placeholder = 'Choose...'): void {
  select.replaceChildren(new Option(placeholder, ''), ...values.map(v => new Option(v.name, v.id)));
  select.value = selected;
}
export function notice(text: string, kind = ''): void {
  const node = el('notice'); node.textContent = text; node.dataset.tone = kind || 'neutral'; node.hidden = !text;
}
/** The update notice, on the pages that have one. It only informs: nothing is ever blocked for being out of date. */
export function showUpdateNotice(options: DeviceOptions | undefined): void {
  const current = globalThis.chrome?.runtime?.getManifest?.().version;
  const outdated = isBelowMinimum(current, options?.minimumExtensionVersion);
  el('update-notice').hidden = !outdated;
  if (!outdated) return;
  el('update-text').textContent = `This extension is version ${current}. Your team's site asks for ${options!.minimumExtensionVersion} or newer. You can keep using it for now.`;
  const link = el<HTMLAnchorElement>('update-link');
  const url = safeUpdateUrl(options!.updateUrl);
  link.hidden = !url;
  if (url) link.href = url; else link.removeAttribute('href');
}
export function errorText(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
