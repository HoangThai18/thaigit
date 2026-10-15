/** English translation of `feedback.vi.ts` (same keys, same parameters). */
import type { feedback as source } from './feedback.vi.ts';
import type { Translation } from './types.ts';

export const feedback: Translation<typeof source> = {
  open: 'Feedback & bug report…',
  title: 'Feedback & bug report',
  intro: (email: string) =>
    `Thaigit opens your email app with a ready-made message to ${email}. You review it and press send yourself — nothing is sent in the background.`,
  kind: 'Type',
  kindBug: 'Bug report',
  kindIdea: 'Suggestion',
  message: 'Message',
  placeholderBug: 'What were you doing when it went wrong? What did you see? Does it happen again?',
  placeholderIdea: 'What would you like Thaigit to have, or do differently?',
  includeInfo: 'Include the Thaigit version and operating system (helps find bugs faster)',
  noRepoData: 'The message contains no repository names, paths or code.',
  infoVersion: (version: string) => `Thaigit version: ${version}`,
  infoSystem: (system: string) => `Operating system: ${system}`,
  subject: (kind: 'bug' | 'idea') => (kind === 'bug' ? '[Thaigit] Bug report' : '[Thaigit] Suggestion'),
  trimmed: '(The message was long and has been shortened — please paste the rest into the email.)',
  send: 'Compose email',
  copy: 'Copy message',
  cancel: 'Cancel',
  empty: 'Write a few lines first',
  opened: 'Your email app is open — check the message, then press send',
  openFailed: (email: string) => `Couldn't open an email app. Copy the message and send it to ${email}`,
  copied: (email: string) => `Message copied — paste it into an email to ${email}`,
  copyFailed: "Couldn't copy the message",
};
