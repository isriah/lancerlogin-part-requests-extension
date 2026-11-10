import { describe, it, expect, vi } from 'vitest';
import { badgeAction, CHECK_EVERY_MS, fetchLatestRelease, isDue, isNewer, isSnoozed, LATEST_RELEASE, parseReleaseUrl, snoozeFor, SNOOZE_MS, UPDATE_BADGE, updateView } from '../src/updates';

const TAG = 'https://github.com/isriah/lancerlogin-part-requests-extension/releases/tag/';
/** A response as fetch gives it after following the redirect: `url` is where it landed. */
const landed = (url: string, status = 200) => Object.defineProperty(new Response(null, { status }), 'url', { value: url });

describe('version compare', () => {
  it.each([
    ['1.0.3', '1.0.2', true], ['1.0.10', '1.0.9', true], ['1.1.0', '1.0.99', true], ['2.0.0', '1.9.9', true], ['v1.0.3', '1.0.2', true], ['1.0.2.1', '1.0.2', true],
    ['1.0.2', '1.0.2', false], ['1.0.2', '1.0.3', false], ['1.0.9', '1.0.10', false], ['1.0', '1.0.0', false], ['1.0.0', '1.0', false],
  ])('%s is newer than %s: %s', (latest, current, newer) => expect(isNewer(latest, current)).toBe(newer));
  it('treats a prerelease as older than its release, and newer than the one before', () => {
    expect(isNewer('1.0.3-beta.1', '1.0.3')).toBe(false);
    expect(isNewer('1.0.3', '1.0.3-beta.1')).toBe(true);
    expect(isNewer('1.0.3-beta.1', '1.0.2')).toBe(true);
    expect(isNewer('1.0.2-rc.1', '1.0.2')).toBe(false);
  });
  it.each([undefined, null, '', 'latest', '1.x', '1.0.0.0.0', 'v', '01.0.0 extra', 42])('never calls %j newer', value => {
    expect(isNewer(value, '1.0.2')).toBe(false);
    expect(isNewer('9.9.9', value)).toBe(false);
  });
});

describe('the tag in the redirect', () => {
  it('reads the version from the release tag page the redirect lands on', () => {
    expect(parseReleaseUrl(`${TAG}v1.0.3`)).toEqual({ version: '1.0.3', url: `${TAG}v1.0.3` });
    expect(parseReleaseUrl(`${TAG}1.2.0`)).toEqual({ version: '1.2.0', url: `${TAG}1.2.0` });
    expect(parseReleaseUrl(`${TAG}v1.0.10/`)).toEqual({ version: '1.0.10', url: `${TAG}v1.0.10` });
    expect(parseReleaseUrl(`${TAG}v1.1.0-beta.2`)).toEqual({ version: '1.1.0-beta.2', url: `${TAG}v1.1.0-beta.2` });
    // A query or fragment is dropped from the link the student gets.
    expect(parseReleaseUrl(`${TAG}v1.0.3?ref=x#notes`)).toEqual({ version: '1.0.3', url: `${TAG}v1.0.3` });
  });
  it.each([
    LATEST_RELEASE, // No redirect happened.
    'https://github.com/isriah/lancerlogin-part-requests-extension/releases',
    `${TAG}`, `${TAG}latest`, `${TAG}v1.0.3/assets`, `${TAG}v1.0.3%2Fx`,
    'https://github.com/someone-else/lancerlogin-part-requests-extension/releases/tag/v9.9.9',
    'https://evil.example.test/isriah/lancerlogin-part-requests-extension/releases/tag/v9.9.9',
    'http://github.com/isriah/lancerlogin-part-requests-extension/releases/tag/v9.9.9',
    'https://github.com.evil.example.test/isriah/lancerlogin-part-requests-extension/releases/tag/v9.9.9',
    'https://github.com/login?return_to=%2Fisriah%2Flancerlogin-part-requests-extension%2Freleases%2Ftag%2Fv9.9.9',
    '', 'not a url', undefined,
  ])('reads nothing from %j', url => expect(parseReleaseUrl(url)).toBeNull());
});

describe('asking GitHub', () => {
  it('follows the releases/latest redirect with a plain request that carries nothing about the student', async () => {
    const fetcher = vi.fn(async () => landed(`${TAG}v1.0.3`));
    expect(await fetchLatestRelease(fetcher as unknown as typeof fetch, 1000)).toEqual({ latest: '1.0.3', url: `${TAG}v1.0.3`, checkedAt: 1000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://github.com/isriah/lancerlogin-part-requests-extension/releases/latest');
    expect(init).toMatchObject({ method: 'HEAD', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', cache: 'no-store' });
    expect(init.headers).toBeUndefined(); expect(init.body).toBeUndefined();
  });
  it('falls back to GET only when HEAD is refused', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'HEAD' ? landed(LATEST_RELEASE, 405) : landed(`${TAG}v1.0.4`));
    expect((await fetchLatestRelease(fetcher as unknown as typeof fetch))?.latest).toBe('1.0.4');
    expect(fetcher.mock.calls.map(call => call[1]?.method)).toEqual(['HEAD', 'GET']);
  });
  it.each([
    ['offline', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a server error', async () => landed(LATEST_RELEASE, 503)],
    ['a rate limit', async () => landed(LATEST_RELEASE, 429)],
    ['an opaque answer with no readable address', async () => landed('', 200)],
    ['a page that is not a tag', async () => landed('https://github.com/login', 200)],
  ])('answers null when %s', async (_name, reply) => {
    const fetcher = vi.fn(reply);
    expect(await fetchLatestRelease(fetcher as unknown as typeof fetch)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('when to ask, and Later', () => {
  const now = 10 * CHECK_EVERY_MS;
  it('asks when never asked, after 24 hours, or when the clock went backwards', () => {
    expect(isDue(undefined, now)).toBe(true);
    expect(isDue({ latest: '1.0.2', url: '', checkedAt: now - CHECK_EVERY_MS }, now)).toBe(true);
    expect(isDue({ latest: '1.0.2', url: '', checkedAt: now - CHECK_EVERY_MS + 1 }, now)).toBe(false);
    expect(isDue({ latest: '1.0.2', url: '', checkedAt: now + 60_000 }, now)).toBe(true);
    expect(isDue({ latest: '1.0.2', url: '', checkedAt: Number.NaN }, now)).toBe(true);
  });
  it('hides one version for 3 days', () => {
    const snooze = snoozeFor('1.0.3', now);
    expect(snooze).toEqual({ version: '1.0.3', until: now + SNOOZE_MS });
    expect(isSnoozed(snooze, '1.0.3', now + SNOOZE_MS - 1)).toBe(true);
    expect(isSnoozed(snooze, '1.0.3', now + SNOOZE_MS)).toBe(false);
    // A newer release than the one put off shows at once.
    expect(isSnoozed(snooze, '1.0.4', now + 1)).toBe(false);
    expect(isSnoozed(undefined, '1.0.3', now)).toBe(false);
    expect(isSnoozed(snooze, undefined, now)).toBe(false);
  });
  it('reports what the pages need', () => {
    const check = { latest: '1.0.3', url: `${TAG}v1.0.3`, checkedAt: now };
    expect(updateView('1.0.2', check, undefined, now)).toEqual({ current: '1.0.2', latest: '1.0.3', url: `${TAG}v1.0.3`, checkedAt: now, available: true, snoozed: false });
    expect(updateView('1.0.2', check, snoozeFor('1.0.3', now), now + 1)).toMatchObject({ available: true, snoozed: true });
    // Once the student has the release, nothing is available and Later no longer matters.
    expect(updateView('1.0.3', check, snoozeFor('1.0.3', now), now + 1)).toMatchObject({ available: false, snoozed: false });
    expect(updateView('1.0.2', undefined, undefined, now)).toEqual({ current: '1.0.2', available: false, snoozed: false });
  });
});

describe('the toolbar badge', () => {
  const available = { available: true, snoozed: false }, current = { available: false, snoozed: false }, later = { available: true, snoozed: true };
  it('goes on an empty badge when a newer version exists', () => expect(badgeAction('', available)).toBe('set'));
  it('stays when it is already showing', () => expect(badgeAction(UPDATE_BADGE, available)).toBe('keep'));
  it('never replaces a badge set for something else', () => {
    expect(badgeAction('3', available)).toBe('keep');
    expect(badgeAction('!', current)).toBe('keep');
    expect(badgeAction('!', later)).toBe('keep');
  });
  it('comes off once the version is current', () => expect(badgeAction(UPDATE_BADGE, current)).toBe('clear'));
  it('comes off after Later', () => expect(badgeAction(UPDATE_BADGE, later)).toBe('clear'));
  it('does nothing to an empty badge when nothing is available', () => {
    expect(badgeAction('', current)).toBe('keep');
    expect(badgeAction('', later)).toBe('keep');
  });
});
