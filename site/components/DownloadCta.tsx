import { fetchMacRelease } from '@/lib/release';
import { LINKS } from '@/lib/site';
import { WindowsIcon } from './Icons';
import { DownloadButton } from './ReleaseInfo';

/** Khối kêu gọi tải app ở cuối các trang con. */
export async function DownloadCta({ title = 'Làm việc với Git nhẹ nhàng hơn' }: { title?: string }) {
  const release = await fetchMacRelease({ cache: 'force-cache' });
  return (
    <aside className="final-cta page-cta">
      <img src="/logo-256.png" width={72} height={72} alt="" />
      <h2>{title}</h2>
      <p>Thaigit — Git client trực quan, miễn phí cho macOS và Windows.</p>
      <div className="cta">
        <DownloadButton initial={release} className="btn btn-white" />
        <a className="btn btn-outline-light" href={LINKS.downloadWindows}>
          <WindowsIcon />
          <span className="btn-stack">
            Tải cho Windows
            <span className="sub">Windows 10 / 11 · miễn phí</span>
          </span>
        </a>
      </div>
    </aside>
  );
}
