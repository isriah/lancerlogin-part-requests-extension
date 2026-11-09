/** The numbers of a version like 0.10.0, or undefined when it is anything else. Chrome's own versions are at most four numbers. */
function parts(version: unknown): number[] | undefined {
  return typeof version === 'string' && /^\d{1,9}(\.\d{1,9}){0,3}$/.test(version) ? version.split('.').map(Number) : undefined;
}
/** Compares number by number, so 0.10.0 is above 0.9.0, and a missing number counts as 0. */
export function compareVersions(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
/** An answer that isn't a version never raises the notice. */
export function isBelowMinimum(current: unknown, minimum: unknown): boolean {
  const [have, need] = [parts(current), parts(minimum)];
  return !!have && !!need && compareVersions(have, need) < 0;
}
export const isVersion = (value: unknown): value is string => parts(value) !== undefined;
