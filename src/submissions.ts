import { AppError } from './notion';
import type { Submission } from './types';

export interface SubmissionStore {
  get(id: string): Promise<Submission | undefined>;
  set(value: Submission): Promise<void>;
}
/** Serialize local check-and-write, persist before POST, and never replay a pending POST. */
export class SubmissionManager {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: SubmissionStore, private now: () => number = Date.now) {}
  submit(id: string, draftKey: string, create: () => Promise<string>): Promise<Submission> {
    const task = this.queue.then(async () => {
      const existing = await this.store.get(id);
      if (existing) return existing.state === 'pending' ? { ...existing, state: 'uncertain' as const, message: 'A previous submission is awaiting confirmation. Check Notion before retrying.' } : existing;
      const pending: Submission = { id, draftKey, state: 'pending', updatedAt: this.now() };
      await this.store.set(pending); // If storage fails, do not make the network request.
      let result: Submission;
      try {
        const pageUrl = await create();
        result = { ...pending, state: 'success', pageUrl, updatedAt: this.now() };
      } catch (error) {
        const known = error instanceof AppError;
        result = { ...pending, state: !known || error.uncertain ? 'uncertain' : 'failed', message: known ? error.message : 'The result could not be confirmed. Check Notion before retrying.', updatedAt: this.now() };
      }
      // If persisting success fails, the durable pending record still prevents a second POST.
      await this.store.set(result);
      return result;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
