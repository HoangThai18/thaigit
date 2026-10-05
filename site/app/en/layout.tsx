import { RootShell } from '@/components/RootShell';
import { ROOT_VIEWPORT, rootMetadata } from '@/lib/seo';

export const metadata = rootMetadata('en');
export const viewport = ROOT_VIEWPORT;

export default function Layout({ children }: { children: React.ReactNode }) {
  return <RootShell lang="en">{children}</RootShell>;
}
