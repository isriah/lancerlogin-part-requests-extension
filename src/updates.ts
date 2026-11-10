// The "update available" check. Students load the extension unpacked from a release zip, so Chrome never updates it or says a newer
// version exists. Once a day the worker asks GitHub which release is the latest, the plain way a browser would: it opens the
// releases/latest page, which redirects to the newest release's tag page, and reads the tag from where it landed. That is not
// GitHub's REST API, whose anonymous limit a whole school shares. The request carries no cookies and nothing about the student
// or the team. No browser APIs here, so the worker, the pages and the tests share it.
import { compareVersions } from './version';

export const RELEASES_PAGE = 'https://github.com/isriah/lancerlogin-part-requests-extension/releases';
export const LATEST_RELEASE = `${RELEASES_PAGE}/latest`;
/** How often to look. The alarm wakes the worker every hour and asks only when the last good answer is older than this. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
/** Later hides the notice for one version for this long. */
export const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
/** The toolbar badge for an update. Anything else on the badge belongs to someone else and is left alone. */
export const UPDATE_BADGE = '↑';

/** What the worker keeps after a good answer. `latest` is a version without the leading v. */
export interface UpdateCheck { latest: string; url: string; checkedAt: number }
export interface UpdateSnooze { version: string; until: number }
/** What the pages are told. */
export interface UpdateView {
  current: string;
  latest?: string;
  url?: string;
  checkedAt?: number;
  /** A newer release exists. */
  available: boolean;
  /** Available, and the student chose Later for this version less than 3 days ago. */
  snoozed: boolean;
}

interface Version { numbers: number[]; prerelease: boolean }
function parseVersion(value: unknown): Version | undefined {
  const match = typeof value === 'string' ? /^v?(\d{1,9}(?:\.\d{1,9}){0,3})(-[0-9A-Za-z.-]+)?$/.exec(value.trim()) : null;
  return match ? { numbers: match[1].split('.').map(Number), prerelease: !!match[2] } : undefined;
}
/**
 * True when `latest` is a newer version than `current`, number by number, so 1.0.10 is above 1.0.9. A prerelease such as
 * 1.0.3-beta.1 counts as older than 1.0.3 itself. Anything that isn't a version is never newer.
 */
export function isNewer(latest: unknown, current: unknown): boolean {
  const [a, b] = [parseVersion(latest), parseVersion(current)];
  if (!a || !b) return false;
  const difference = compareVersions(a.numbers, b.numbers);
  if (difference) return difference > 0;
  return !a.prerelease && b.prerelease;
}
/** The release a tag page URL names, or null for any other address. Only this repository's tag pages count. */
export function parseReleaseUrl(address: unknown): { version: string; url: string } | null {
  if (typeof address !== 'string') return null;
  let url: URL;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== 'https:' || url.host !== 'github.com') return null;
  const prefix = '/isriah/lancerlogin-part-requests-extension/releases/tag/';
  if (!url.pathname.toLowerCase().startsWith(prefix)) return null;
  let tag: string;
  try { tag = decodeURIComponent(url.pathname.slice(prefix.length).replace(/\/$/, '')); } catch { return null; }
  const version = parseVersion(tag);
  if (!version || tag.includes('/')) return null;
  return { version: tag.replace(/^v/, ''), url: `https://github.com${prefix}${encodeURIComponent(tag)}` };
}
/** Whether to ask GitHub now. A failed try leaves `checkedAt` alone, so the next hourly wake tries again. */
export const isDue = (check: UpdateCheck | undefined, now: number): boolean => !check || !Number.isFinite(check.checkedAt) || now - check.checkedAt >= CHECK_EVERY_MS || check.checkedAt > now;
export const isSnoozed = (snooze: UpdateSnooze | undefined, latest: string | undefined, now: number): boolean => !!snooze && !!latest && snooze.version === latest && now < snooze.until;
export const snoozeFor = (version: string, now: number): UpdateSnooze => ({ version, until: now + SNOOZE_MS });
export function updateView(current: string, check: UpdateCheck | undefined, snooze: UpdateSnooze | undefined, now: number): UpdateView {
  const available = !!check && isNewer(check.latest, current);
  return { current, ...(check ? { latest: check.latest, url: check.url, checkedAt: check.checkedAt } : {}), available, snoozed: available && isSnoozed(snooze, check?.latest, now) };
}
/**
 * What to do with the toolbar badge, given the text on it now. The update badge goes on only when the badge is empty or already
 * ours, and comes off only when it is ours, so another badge is never replaced or cleared. Later takes the badge off too.
 */
export function badgeAction(currentText: string, view: Pick<UpdateView, 'available' | 'snoozed'>): 'set' | 'clear' | 'keep' {
  const wanted = view.available && !view.snoozed;
  if (wanted) return currentText === '' ? 'set' : 'keep';
  return currentText === UPDATE_BADGE ? 'clear' : 'keep';
}
/**
 * Asks GitHub for the latest release and returns it, or null for any failure: offline, a timeout, a page GitHub changed, or an
 * answer whose final address can't be read. A HEAD request is enough to follow the redirect, and a GET is the fallback for a
 * server that refuses HEAD. `fetcher` is injectable for the tests.
 */
export async function fetchLatestRelease(fetcher: typeof fetch = fetch, now = Date.now()): Promise<UpdateCheck | null> {
  for (const method of ['HEAD', 'GET']) {
    try {
      const response = await fetcher(LATEST_RELEASE, { method, credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(TIMEOUT_MS) });
      const release = response.ok ? parseReleaseUrl(response.url) : null;
      if (release) return { latest: release.version, url: release.url, checkedAt: now };
      if (response.ok || response.status !== 405) return null;
    } catch { return null; }
  }
  return null;
}
