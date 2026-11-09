export class AppError extends Error {
  /**
   * @param uncertain the request may have gone through, so never resend it on its own
   * @param notRecorded the server recorded nothing, so the draft stays open and the same ID stays good
   */
  constructor(message: string, public code = 'validation', public uncertain = false, public notRecorded = false, public details?: unknown) { super(message); }
}
