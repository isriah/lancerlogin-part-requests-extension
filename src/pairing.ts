import { AppError } from './errors';

/**
 * The site's origin from whatever a student pasted: a bare host, the dashboard address, or a link with a path.
 * Only https is accepted. Plain http is allowed for localhost only when the manifest allows it, which only a test build does.
 */
export function normalizeSiteAddress(input: string, allowLocalHttp = false): string {
  let text = String(input ?? '').trim();
  if (!text) throw new AppError('Enter the site address from the Discord reply.');
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try { url = new URL(text); } catch { throw new AppError('That site address does not look right. Copy it from the Discord reply.'); }
  // The origin becomes a Chrome match pattern, so a wildcard here would ask for far more than one site.
  if (url.username || url.password || !/^[a-z\d.-]+$/.test(url.hostname)) throw new AppError('That site address does not look right. Copy it from the Discord reply.');
  if (url.protocol === 'http:' && allowLocalHttp && ['localhost', '127.0.0.1'].includes(url.hostname)) return url.origin;
  if (url.protocol !== 'https:') throw new AppError('The site address must start with https://.');
  if (!url.hostname.includes('.')) throw new AppError('Enter the full site address from the Discord reply.');
  return url.origin;
}
/** The dashboard address serves Core's Worker under /api through its Pages proxy. */
export const apiBase = (origin: string): string => `${origin}/api/public/part-requests`;
export const originPattern = (origin: string): string => `${origin}/*`;

const PIN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
/** A PIN as pasted or typed: any case, with or without its hyphen. Letters and digits Discord never sends are refused here. */
export function normalizePin(input: string): string {
  const pin = String(input ?? '').toUpperCase().replace(/[\s*-]/g, '');
  if (!PIN.test(pin)) throw new AppError('Enter the 8-character PIN from /ordering-pin in Discord, like K7M2-9QXP.');
  return pin;
}
/** Only a test build's manifest lists an http pattern. */
export const manifestAllowsLocalHttp = (manifest: object): boolean => ((manifest as { optional_host_permissions?: string[] }).optional_host_permissions ?? []).some(p => p.startsWith('http://'));
export const cleanDeviceLabel = (input: string): string => String(input ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
