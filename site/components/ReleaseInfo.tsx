'use client';

import { useEffect, useState } from 'react';
import { fetchMacRelease, formatDate, formatSize, type MacRelease } from '@/lib/release';
import { LINKS } from '@/lib/site';
import { AppleIcon } from './Icons';

// Một lần hỏi GitHub cho cả trang (nhiều nút tải dùng chung).
let pending: Promise<MacRelease | null> | null = null;

function useMacRelease(initial: MacRelease | null): MacRelease | null {
  const [release, setRelease] = useState(initial);
  useEffect(() => {
    let alive = true;
    pending ??= fetchMacRelease({ cache: 'no-store' });
    void pending.then((latest) => {
      if (alive && latest) setRelease(latest);
    });
    return () => {
      alive = false;
    };
  }, []);
  return release;
}

/** Nút tải bản macOS: số phiên bản + dung lượng lấy từ GitHub Releases (dựng sẵn lúc build, làm mới khi mở trang). */
export function DownloadButton({ initial, className = 'btn btn-primary' }: { initial: MacRelease | null; className?: string }) {
  const release = useMacRelease(initial);
  return (
    <a className={className} href={release ? LINKS.downloadMac : LINKS.releases} data-download="mac">
      <AppleIcon />
      <span className="btn-stack">
        Tải cho macOS
        <span className="sub">{release ? `Phiên bản ${release.version} · ${formatSize(release.size)}` : 'macOS 14 trở lên · miễn phí'}</span>
      </span>
    </a>
  );
}

/** Ngày phát hành + SHA-256 để tự kiểm file tải về (`shasum -a 256 Thaigit-macOS.zip`). */
export function ReleaseDetails({ initial }: { initial: MacRelease | null }) {
  const release = useMacRelease(initial);
  if (!release) {
    return <p className="hash">Bản phát hành đầu tiên đang được chuẩn bị — có thể build ngay từ mã nguồn.</p>;
  }
  return (
    <p className="hash">
      Phát hành {formatDate(release.publishedAt)}
      {release.sha256 && (
        <>
          <br />
          SHA-256: <code>{release.sha256}</code>
        </>
      )}
    </p>
  );
}
