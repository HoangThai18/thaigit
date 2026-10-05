import type { ForgeProvider } from '@thaigit/contracts';
import { vi } from '../strings.vi.ts';

export interface RequestWording {
  create: string;
  createFrom: (branch: string) => string;
  submit: string;
  notPushed: (branch: string) => string;
  rejected: string;
  createdToast: (number: string) => string;
  buttonLabel: string;
  buttonTip: (branch: string) => string;
  buttonNoBranch: string;
  /** Tiêu đề panel review: `Pull Request #12` / `Merge Request !12`. */
  reviewHeading: (number: string) => string;
  /** Số hiệu ngắn: `#12` (GitLab: `!12`). */
  reviewRef: (number: string) => string;
}

export function requestWording(provider: ForgeProvider | null | undefined): RequestWording {
  const text = vi.pullRequests;
  return provider === 'gitlab' ? text.merge : text;
}
