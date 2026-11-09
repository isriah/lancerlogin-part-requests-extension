import type { PageStop } from './store-method';

/**
 * Injected into the store's tab after every load, and self-contained because Chrome serializes it. It only looks: nothing here clicks,
 * types or waits for a challenge to clear. Finding anything stops the store, and the person deals with it on the store's own site.
 */
export function inspectPage(): { kind: 'ok' } | PageStop {
  const shown = (node: Element): boolean => {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return box.width > 20 && box.height > 10 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  // Named for the challenge itself. Invisible reCAPTCHA badges sit on ordinary store pages and don't count.
  const challenge = ['#challenge-form', '#challenge-stage', '#cf-challenge-running', '.cf-browser-verification', '#px-captcha', '#captcha-form', 'form[action*="validateCaptcha"]', 'iframe[title*="challenge" i]', 'iframe[src*="challenges.cloudflare.com"]', 'iframe[src*="hcaptcha.com"]', 'iframe[src*="recaptcha"][src*="bframe"]', 'iframe[src*="geo.captcha-delivery.com"]', 'iframe[src*="punish"]'];
  if (challenge.some(selector => [...document.querySelectorAll(selector)].some(shown))) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check' };
  const title = document.title || '';
  const wall = /just a moment|attention required|verify you are (a )?human|are you a (robot|human)|access denied|access to this page has been denied|pardon our interruption|robot check|security check|unusual traffic|press (&|and) hold/i;
  const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
  if (wall.test(title) || body.length < 2000 && wall.test(body)) return { kind: 'stop', reason: 'bot-check', detail: 'a CAPTCHA or bot check' };
  if ([...document.querySelectorAll('input[type="password"]')].some(shown)) return { kind: 'stop', reason: 'login', detail: 'a sign-in page' };
  if (/please (log|sign) in|(log|sign) in to continue/i.test(body.slice(0, 20000))) return { kind: 'stop', reason: 'login', detail: 'a sign-in page' };
  return { kind: 'ok' };
}
