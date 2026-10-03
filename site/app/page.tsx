import { Compare } from '@/components/Compare';
import { CopyCode } from '@/components/CopyCode';
import { Effects } from '@/components/Effects';
import { Faq } from '@/components/Faq';
import { FeatureTabs } from '@/components/FeatureTabs';
import {
  AppleIcon,
  KeyboardIcon,
  MoonIcon,
  RefreshIcon,
  ShieldIcon,
  SplitIcon,
  UndoIcon,
  WindowsIcon,
} from '@/components/Icons';
import { DownloadButton, ReleaseDetails } from '@/components/ReleaseInfo';
import { Shot } from '@/components/Shot';
import { formatDate, readChangelog } from '@/lib/changelog';
import { FAQ, FEATURES, SMALL_FEATURES, type SmallFeature } from '@/lib/content';
import { fetchMacRelease } from '@/lib/release';
import { LINKS, SITE } from '@/lib/site';

const ICONS: Record<SmallFeature['icon'], () => React.ReactElement> = {
  split: () => <SplitIcon />,
  undo: () => <UndoIcon />,
  refresh: () => <RefreshIcon />,
  moon: () => <MoonIcon />,
  shield: () => <ShieldIcon />,
  keyboard: () => <KeyboardIcon />,
};

const GALLERY = [
  { shot: 'diff-split', caption: 'Diff tách đôi: trước | sau' },
  { shot: 'image-diff', caption: 'Diff ảnh' },
  { shot: 'welcome', caption: 'Mở, clone hoặc tạo repository' },
] as const;

/** Số thay đổi hiện sẵn cho mỗi bản; phần còn lại gập trong "Xem thêm". */
const RELEASE_ITEMS = 4;

export default async function HomePage() {
  // Lúc build: số phiên bản mới nhất có sẵn trong HTML (tốt cho SEO); trong trình duyệt nút tải tự làm mới.
  const [release, changelog] = await Promise.all([
    fetchMacRelease({ cache: 'force-cache' }),
    readChangelog(3),
  ]);

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE.name,
      description: SITE.description,
      url: SITE.url,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS 14+, Windows 10/11',
      downloadUrl: LINKS.downloadMac,
      ...(release ? { softwareVersion: release.version } : {}),
      image: `${SITE.url}/logo-256.png`,
      screenshot: `${SITE.url}/screenshots/overview-1600.webp`,
      inLanguage: 'vi',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'VND' },
      author: { '@type': 'Person', name: SITE.author },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a.join(' ') },
      })),
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Effects />

      {/* Hero */}
      <section className="hero">
        <div className="hero-bg" aria-hidden="true">
          <div className="orb orb-orange" />
          <div className="orb orb-blue" />
          <div className="grid-lines" />
        </div>

        <div className="hero-inner container">
          <span className="eyebrow">
            <span className="pulse-dot" aria-hidden="true" />
            Miễn phí · Không cần tài khoản
          </span>
          <h1>
            Git trực quan, làm bằng chuột.
            <br />
            <span className="gradient-text">Miễn phí, nhẹ, dễ dùng.</span>
          </h1>
          <p className="lead">
            Thaigit giúp bạn làm việc với Git bằng chuột: graph lịch sử nhiều màu, kéo nhánh thả lên nhánh để
            merge, stage từng dòng, giải conflict trong vài cú bấm — không cần nhớ lệnh.
          </p>
          <div className="cta">
            <DownloadButton initial={release} />
            <a className="btn btn-glass" href={LINKS.downloadWindows} title="Thaigit cho Windows 10 / 11">
              <WindowsIcon />
              <span className="btn-stack">
                Tải cho Windows
                <span className="sub">Windows 10 / 11 · miễn phí</span>
              </span>
            </a>
          </div>
          <div className="checks-row">
            <span>macOS 14 · Windows 10 / 11</span>
            <span>Tự cập nhật</span>
            <span>Giao diện tiếng Việt</span>
            <span>Sáng / tối</span>
          </div>

          <div className="hero-stage">
            <div className="hero-glow" aria-hidden="true" />
            <div className="hero-frame" data-tilt>
              <div className="beam" aria-hidden="true" />
              <div className="hero-frame-inner">
                <Shot
                  name="overview-dark"
                  alt="Thaigit: graph commit nhiều màu, sidebar nhánh và panel commit"
                  priority
                  sizes="(max-width: 1140px) 100vw, 1100px"
                />
              </div>
            </div>
            <div className="float-badge b1" aria-hidden="true">
              <span className="dot" />
              Kéo &amp; thả để merge
            </div>
            <div className="float-badge b2" aria-hidden="true">
              <span className="dot" />
              Tìm &amp; chuyển nhánh
              <kbd>⌘B</kbd>
            </div>
            <div className="float-badge b3" aria-hidden="true">
              <span className="dot" />
              Stage từng dòng
            </div>
          </div>

          <div className="stats">
            <div className="stat" data-spot data-reveal>
              <strong>≈ 1 giây</strong>
              <span>mở repo 30.000 commit</span>
            </div>
            <div className="stat" data-spot data-reveal>
              <strong>Từng dòng</strong>
              <span>stage, bỏ stage, huỷ</span>
            </div>
            <div className="stat" data-spot data-reveal>
              <strong>1 cú kéo</strong>
              <span>merge, rebase, push</span>
            </div>
            <div className="stat warm" data-spot data-reveal>
              <strong>0 đồng</strong>
              <span>miễn phí, không quảng cáo</span>
            </div>
          </div>
        </div>
      </section>

      {/* Tính năng */}
      <section id="tinh-nang" className="section container">
        <div className="section-head" data-reveal>
          <span className="kicker">Tính năng</span>
          <h2>Mọi việc với Git, gọn trong một cửa sổ</h2>
          <p>
            Thaigit gọi thẳng git trên máy bạn nên kết quả giống hệt dùng terminal — chỉ dễ nhìn và dễ bấm
            hơn.
          </p>
        </div>

        <FeatureTabs features={FEATURES} />

        <div className="cards">
          {SMALL_FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="card"
              data-spot
              data-reveal
              style={{ '--c1': feature.colors[0], '--c2': feature.colors[1] } as React.CSSProperties}
            >
              <div className="icon">{ICONS[feature.icon]()}</div>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Giao diện */}
      <section className="section container" aria-labelledby="giao-dien-tieu-de">
        <div className="section-head" data-reveal>
          <span className="kicker">Giao diện</span>
          <h2 id="giao-dien-tieu-de">Đẹp ở cả giao diện sáng lẫn tối</h2>
        </div>
        <div className="window" data-reveal>
          <Compare />
        </div>
        <div className="gallery">
          {GALLERY.map((item) => (
            <figure key={item.shot} data-reveal>
              <div className="frame">
                <Shot name={item.shot} sizes="(max-width: 700px) 100vw, 380px" />
                <figcaption>{item.caption}</figcaption>
              </div>
            </figure>
          ))}
        </div>
      </section>

      {/* Tải về */}
      <section id="tai-ve" className="section container">
        <div className="section-head" data-reveal>
          <span className="kicker">Tải về</span>
          <h2>Tải Thaigit</h2>
          <p>Miễn phí, không cần tài khoản. Các bản sau tự cập nhật.</p>
        </div>
        <div className="downloads">
          <div className="dl-ring" data-os="mac" data-reveal>
            <div className="dl-card">
              <div className="dl-card-head">
                <h3>
                  <AppleIcon size={24} /> macOS
                </h3>
                <span className="fit-badge">Phù hợp với máy bạn</span>
              </div>
              <p className="meta">macOS 14 Sonoma trở lên · Mac chip Apple (M1 trở lên)</p>
              <DownloadButton initial={release} className="btn btn-primary btn-block" />
              <ol className="steps">
                <li>Mở file Thaigit-macOS.zip để giải nén.</li>
                <li>Kéo Thaigit.app vào thư mục Applications.</li>
                <li>
                  <span>
                    Lần đầu mở, nếu macOS chặn: Cài đặt hệ thống → Quyền riêng tư &amp; Bảo mật →{' '}
                    <strong>Vẫn mở</strong>. Hoặc chạy:
                  </span>
                </li>
              </ol>
              <CopyCode code="xattr -dr com.apple.quarantine /Applications/Thaigit.app" />
              <ReleaseDetails initial={release} />
            </div>
          </div>

          <div className="dl-ring" data-os="win" data-reveal>
            <div className="dl-card">
              <div className="dl-card-head">
                <h3>
                  <WindowsIcon size={24} /> Windows
                </h3>
                <span className="fit-badge">Phù hợp với máy bạn</span>
              </div>
              <p className="meta">Windows 10 / 11 · 64-bit</p>
              <a className="btn btn-primary btn-block" href={LINKS.downloadWindows}>
                <WindowsIcon /> Tải cho Windows
              </a>
              <ol className="steps">
                <li>
                  <span>
                    Cần có Git: cài <a href={LINKS.gitForWindows}>Git for Windows</a> nếu máy chưa có.
                  </span>
                </li>
                <li>Mở file Thaigit-Windows-setup.exe để cài (không cần quyền quản trị).</li>
                <li>
                  <span>
                    Bản cài chưa ký số nên lần đầu Windows SmartScreen có thể cảnh báo: bấm{' '}
                    <strong>More info</strong> → <strong>Run anyway</strong>.
                  </span>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* Có gì mới */}
      {changelog.length > 0 && (
        <section id="co-gi-moi" className="section narrow container">
          <div className="section-head" data-reveal>
            <span className="kicker">Có gì mới</span>
            <h2>Nhật ký thay đổi</h2>
          </div>
          <div className="timeline">
            {changelog.map((entry) => {
              const shown = entry.items.slice(0, RELEASE_ITEMS);
              const more = entry.items.slice(RELEASE_ITEMS);
              return (
                <article
                  key={`${entry.platform}-${entry.version}`}
                  className="release"
                  data-os={entry.platform === 'Windows' ? 'win' : 'mac'}
                  data-reveal
                >
                  <div className="release-body">
                    <header>
                      <span className="release-os">
                        {entry.platform === 'Windows' ? <WindowsIcon size={14} /> : <AppleIcon size={14} />}
                        {entry.platform}
                      </span>
                      <h3>{entry.version}</h3>
                      {entry.date && <time dateTime={entry.date}>{formatDate(entry.date)}</time>}
                    </header>
                    {entry.summary && <p className="release-summary">{entry.summary}</p>}
                    <ul className="release-items">
                      {shown.map((item, index) => (
                        <li key={index}>
                          <strong>{item.title}</strong>
                          {item.detail && <span>{item.detail}</span>}
                        </li>
                      ))}
                    </ul>
                    {more.length > 0 && (
                      <details className="release-more">
                        <summary>Xem thêm {more.length} thay đổi</summary>
                        <ul className="release-items">
                          {more.map((item, index) => (
                            <li key={index}>
                              <strong>{item.title}</strong>
                              {item.detail && <span>{item.detail}</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Hỏi đáp */}
      <section id="hoi-dap" className="section narrow container">
        <div className="section-head" data-reveal>
          <span className="kicker">Hỏi đáp</span>
          <h2>Câu hỏi thường gặp</h2>
        </div>
        <Faq items={FAQ} />
      </section>

      {/* English */}
      <section className="section tight narrow container" lang="en" aria-labelledby="in-english">
        <div className="english" data-reveal>
          <h2 id="in-english">In English</h2>
          <p>
            Thaigit is a free, visual Git GUI with a Liquid Glass look: a colorful commit graph, drag-and-drop
            to merge, rebase or push, line-by-line staging and a friendly conflict resolver. The native macOS
            app updates itself from GitHub Releases. The Windows app (Tauri 2, Windows 10/11) also updates
            itself. The UI is Vietnamese for now.
          </p>
        </div>
      </section>

      {/* Kêu gọi cuối */}
      <section className="section tight container">
        <div className="final-cta" data-reveal>
          <img src="/logo-256.png" width={88} height={88} alt="" />
          <h2>Làm việc với Git nhẹ nhàng hơn từ hôm nay</h2>
          <p>Tải Thaigit miễn phí cho macOS và Windows.</p>
          <div className="cta">
            <DownloadButton initial={release} className="btn btn-white" />
            <a
              className="btn btn-outline-light"
              href={LINKS.downloadWindows}
              title="Thaigit cho Windows 10 / 11"
            >
              <WindowsIcon />
              <span className="btn-stack">
                Tải cho Windows
                <span className="sub">Windows 10 / 11 · miễn phí</span>
              </span>
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
