// Feedback / bug reports go out as an email the user sends from their own mail app: no server endpoint to abuse,
// and the user sees exactly what is sent. Rust caps URLs at 2048 bytes, so the message is trimmed to fit.

export const FEEDBACK_EMAIL = 'phanthai18072001@gmail.com';

export type FeedbackKind = 'bug' | 'idea';

const MAX_URL = 2048;

export interface FeedbackDraft {
  readonly kind: FeedbackKind;
  readonly message: string;
  /** App version / OS / architecture lines appended to the body; null when the user unticked "include". */
  readonly info: string | null;
}

export interface FeedbackLabels {
  readonly subject: (kind: FeedbackKind) => string;
  readonly trimmed: string;
}

export function feedbackBody(draft: FeedbackDraft): string {
  const message = draft.message.trim();
  return draft.info === null ? message : `${message}\n\n---\n${draft.info}`;
}

function mailto(subject: string, body: string): string {
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** The `mailto:` URL; a message too long for the URL limit is cut (by characters) and ends with `labels.trimmed`. */
export function feedbackMailto(
  draft: FeedbackDraft,
  labels: FeedbackLabels,
): { url: string; trimmed: boolean } {
  const subject = labels.subject(draft.kind);
  const full = mailto(subject, feedbackBody(draft));
  if (full.length <= MAX_URL) return { url: full, trimmed: false };
  const chars = [...draft.message.trim()];
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = { ...draft, message: `${chars.slice(0, mid).join('')}…\n\n${labels.trimmed}` };
    if (mailto(subject, feedbackBody(candidate)).length <= MAX_URL) low = mid;
    else high = mid - 1;
  }
  const message = `${chars.slice(0, low).join('')}…\n\n${labels.trimmed}`;
  return { url: mailto(subject, feedbackBody({ ...draft, message })), trimmed: true };
}
