import { AppError } from './errors';
import type { Repeat, Submission, SubmissionFacts } from './types';

export interface SubmissionStore {
  get(id: string): Promise<Submission | undefined>;
  set(value: Submission): Promise<void>;
  remove(id: string): Promise<void>;
}
export interface Created { pageUrl: string; repeats?: Repeat[] }
/** Serialize local check-and-write, persist before POST, and never replay a pending POST. */
export class SubmissionManager {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: SubmissionStore, private now: () => number = Date.now) {}
  submit(id: string, draftKey: string, create: () => Promise<Created>, meta: { express?: boolean; facts?: SubmissionFacts } = {}): Promise<Submission> {
    const task = this.queue.then(async () => {
      const existing = await this.store.get(id);
      if (existing) return existing.state === 'pending' ? { ...existing, state: 'uncertain' as const, message: 'A previous submission is awaiting confirmation. Check Notion before retrying.' } : existing;
      const pending: Submission = { id, draftKey, state: 'pending', updatedAt: this.now(), ...meta };
      await this.store.set(pending); // If storage fails, do not make the network request.
      let result: Submission;
      try {
        const { pageUrl, repeats } = await create();
        result = { ...pending, state: 'success', pageUrl, recorded: true, ...(repeats?.length ? { repeats } : {}), updatedAt: this.now() };
      } catch (error) {
        // The server recorded nothing, so there is no result to keep: the draft stays open and this ID stays good.
        if (error instanceof AppError && error.notRecorded) { await this.store.remove(id); throw error; }
        const known = error instanceof AppError;
        const uncertain = !known || error.uncertain;
        result = { ...pending, state: uncertain ? 'uncertain' : 'failed', recorded: known && error.code !== 'network', message: known ? error.message : 'The result could not be confirmed. Check Notion before retrying.', updatedAt: this.now() };
      }
      // If persisting success fails, the durable pending record still prevents a second POST.
      await this.store.set(result);
      return result;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
