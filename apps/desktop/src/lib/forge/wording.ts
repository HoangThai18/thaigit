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
}

export function requestWording(provider: ForgeProvider | null | undefined): RequestWording {
  const text = vi.pullRequests;
  return provider === 'gitlab' ? text.merge : text;
}
