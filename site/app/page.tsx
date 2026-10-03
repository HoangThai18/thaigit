import { CopyCode } from '@/components/CopyCode';
import {
  AppleIcon,
  GitHubIcon,
  KeyboardIcon,
  MoonIcon,
  RefreshIcon,
  ShieldIcon,
  SparkIcon,
  SplitIcon,
  UndoIcon,
  WindowsIcon,
} from '@/components/Icons';
import { DownloadButton, ReleaseDetails } from '@/components/ReleaseInfo';
import { Shot } from '@/components/Shot';
import { readChangelog } from '@/lib/changelog';
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
      operatingSystem: 'macOS 14+, Windows 10/11 (beta)',
      downloadUrl: LINKS.downloadMac,
      ...(release ? { softwareVersion: release.version } : {}),
      image: `${SITE.url}/logo-256.png`,
      screenshot: `${SITE.url}/screenshots/overview-1600.webp`,
      inLanguage: 'vi',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'VND' },
      author: { '@type': 'Person', name: SITE.author, url: LINKS.github },
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

      {/* Hero */}
      <section className="hero container">
        <span className="eyebrow glass">
          <span className="dot" aria-hidden="true" />
          Miễn phí · Không cần tài khoản · Mã nguồn công khai
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
          <a className="btn btn-secondary" href={LINKS.downloadWindows} title="Bản thử cho Windows 10 / 11">
            <WindowsIcon />
            <span className="btn-stack">
              Windows
              <span className="sub">Bản thử (beta)</span>
            </span>
          </a>
        </div>
        <div className="chips">
          <span>macOS 14 trở lên</span>
          <span>Tự cập nhật</span>
          <span>Giao diện tiếng Việt</span>
          <span>Sáng / tối</span>
        </div>
        <div className="hero-shot glass">
          <picture>
            <source
              media="(prefers-color-scheme: dark)"
              srcSet="/screenshots/overview-dark-800.webp 800w, /screenshots/overview-dark-1600.webp 1600w"
              sizes="(max-width: 1140px) 100vw, 1100px"
            />
            <Shot name="overview" priority sizes="(max-width: 1140px) 100vw, 1100px" />
          </picture>
        </div>
        <div className="stats">
          <div className="stat glass">
            <strong>≈ 1 giây</strong>
            <span>mở repo 30.000 commit</span>
          </div>
          <div className="stat glass">
            <strong>Từng dòng</strong>
            <span>stage, bỏ stage, huỷ</span>
          </div>
          <div className="stat glass">
            <strong>1 cú kéo</strong>
            <span>merge, rebase, push</span>
          </div>
          <div className="stat glass">
            <strong>0 đồng</strong>
            <span>miễn phí, không quảng cáo</span>
          </div>
        </div>
      </section>

      {/* Tính năng */}
      <section id="tinh-nang" className="section container">
        <div className="section-head">
          <span className="kicker">Tính năng</span>
          <h2>Mọi việc với Git, gọn trong một cửa sổ</h2>
          <p>
            Thaigit gọi thẳng git trên máy bạn nên kết quả giống hệt dùng terminal — chỉ dễ nhìn và dễ bấm
            hơn.
          </p>
        </div>

        {FEATURES.map((feature, index) => (
          <article
            key={feature.id}
            id={feature.id}
            className={`feature reveal${index % 2 === 1 ? ' reverse' : ''}`}
          >
            <div className="feature-media glass">
              <Shot name={feature.shot} />
            </div>
            <div className="feature-text">
              <span className="tag">{feature.tag}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
              <ul className="checks">
                {feature.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}

        <div className="grid">
          {SMALL_FEATURES.map((feature) => (
            <div key={feature.title} className="card glass reveal">
              <div
                className="icon"
                style={{ '--c1': feature.colors[0], '--c2': feature.colors[1] } as React.CSSProperties}
              >
                {ICONS[feature.icon]()}
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Ảnh giao diện */}
      <section className="section container" aria-labelledby="giao-dien-tieu-de">
        <div className="section-head">
          <span className="kicker">Giao diện</span>
          <h2 id="giao-dien-tieu-de">Đẹp ở cả giao diện sáng lẫn tối</h2>
        </div>
        <div className="gallery">
          <figure className="glass reveal">
            <Shot name="overview-dark" sizes="(max-width: 640px) 100vw, 560px" />
            <figcaption>Giao diện tối</figcaption>
          </figure>
          <figure className="glass reveal">
            <Shot name="diff-split" sizes="(max-width: 640px) 100vw, 560px" />
            <figcaption>Diff tách đôi: trước | sau</figcaption>
          </figure>
          <figure className="glass reveal">
            <Shot name="image-diff" sizes="(max-width: 640px) 100vw, 560px" />
            <figcaption>Diff ảnh</figcaption>
          </figure>
          <figure className="glass reveal">
            <Shot name="welcome" sizes="(max-width: 640px) 100vw, 560px" />
            <figcaption>Mở, clone hoặc tạo repository</figcaption>
          </figure>
        </div>
      </section>

      {/* AI */}
      <section id="ai" className="section container">
        <div className="ai glass reveal">
          <div>
            <span className="badge">Bản Windows — sắp có</span>
            <h2>AI viết commit message cho bạn</h2>
            <p style={{ color: 'var(--text-2)' }}>
              Bấm một nút, Thaigit đọc phần thay đổi đã stage và đề xuất message rõ ràng. Bản macOS dùng Apple
              Intelligence ngay trên máy; bản Windows dùng model Hermes chạy trên máy chủ của Thaigit.
            </p>
            <ul className="checks">
              <li>Không cần API key, không tốn phí</li>
              <li>Không gửi cho bên thứ ba, không lưu code hay message</li>
              <li>Tự bỏ .env, khoá bí mật, file nhị phân trước khi gửi</li>
              <li>Chỉ chạy khi bạn bấm và đã đồng ý</li>
            </ul>
          </div>
          <div className="commit-demo" aria-label="Ví dụ commit message do AI viết">
            <div className="label">Thay đổi đã stage: 3 file · +42 −7</div>
            <div className="message">
              {
                'feat(auth): thêm đăng nhập qua API /login\n\n- Kiểm tra dữ liệu rỗng trước khi so khớp\n- Trả 401 khi sai tài khoản hoặc mật khẩu'
              }
            </div>
            <span className="spark">
              <SparkIcon /> Viết bằng AI
            </span>
          </div>
        </div>
      </section>

      {/* Tải về */}
      <section id="tai-ve" className="section container">
        <div className="section-head">
          <span className="kicker">Tải về</span>
          <h2>Tải Thaigit</h2>
          <p>Miễn phí, không cần tài khoản. Các bản sau tự cập nhật.</p>
        </div>
        <div className="downloads">
          <div className="download-card glass">
            <h3>
              <AppleIcon size={24} /> macOS
            </h3>
            <p className="meta">macOS 14 Sonoma trở lên · Mac chip Apple (M1 trở lên)</p>
            <DownloadButton initial={release} />
            <ol className="steps">
              <li>Mở file Thaigit-macOS.zip để giải nén.</li>
              <li>Kéo Thaigit.app vào thư mục Applications.</li>
              <li>
                Lần đầu mở, nếu macOS chặn: Cài đặt hệ thống → Quyền riêng tư &amp; Bảo mật →{' '}
                <strong>Vẫn mở</strong>. Hoặc chạy:
              </li>
            </ol>
            <CopyCode code="xattr -dr com.apple.quarantine /Applications/Thaigit.app" />
            <ReleaseDetails initial={release} />
          </div>

          <div className="download-card glass">
            <h3>
              <WindowsIcon size={24} /> Windows
            </h3>
            <p className="meta">Windows 10 / 11 · 64-bit · bản thử (beta)</p>
            <a className="btn btn-primary" href={LINKS.downloadWindows}>
              <WindowsIcon /> Tải cho Windows
            </a>
            <ol className="steps">
              <li>
                Cần có Git: cài <a href={LINKS.gitForWindows}>Git for Windows</a> nếu máy chưa có.
              </li>
              <li>Mở file Thaigit-Windows-setup.exe để cài (không cần quyền quản trị).</li>
              <li>
                Bản cài chưa ký số nên lần đầu Windows SmartScreen có thể cảnh báo: bấm{' '}
                <strong>More info</strong> → <strong>Run anyway</strong>.
              </li>
            </ol>
            <p className="hash">
              App tự cập nhật lên bản thử mới. Xem <a href={LINKS.changelogWindows}>có gì mới</a> ·{' '}
              <a href={LINKS.releases}>mọi bản phát hành</a>.
            </p>
          </div>

          <div className="download-card glass">
            <h3>
              <GitHubIcon size={24} /> Từ mã nguồn
            </h3>
            <p className="meta">Cần Xcode hoặc Command Line Tools · chạy được cả trên Mac Intel</p>
            <CopyCode
              code={
                'git clone https://github.com/HoangThai18/thaigit.git\ncd thaigit\n./scripts/build-app.sh --install'
              }
            />
            <p className="hash">
              Lệnh trên build bản release rồi chép vào /Applications. Chi tiết trong{' '}
              <a href={LINKS.github}>README</a>.
            </p>
          </div>
        </div>
      </section>

      {/* Có gì mới */}
      {changelog.length > 0 && (
        <section id="co-gi-moi" className="section container">
          <div className="section-head">
            <span className="kicker">Có gì mới</span>
            <h2>Nhật ký thay đổi</h2>
          </div>
          <div className="changelog">
            {changelog.map((entry) => (
              <article key={entry.version} className="release glass">
                <header>
                  <h3>Thaigit {entry.version}</h3>
                  {entry.date && <time dateTime={entry.date}>{entry.date}</time>}
                </header>
                {entry.summary && <p>{entry.summary}</p>}
                <ul>
                  {entry.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
            <p style={{ textAlign: 'center', marginTop: 20 }}>
              <a href={LINKS.changelog}>Xem toàn bộ nhật ký thay đổi →</a>
            </p>
          </div>
        </section>
      )}

      {/* Hỏi đáp */}
      <section id="hoi-dap" className="section container">
        <div className="section-head">
          <span className="kicker">Hỏi đáp</span>
          <h2>Câu hỏi thường gặp</h2>
        </div>
        <div className="faq">
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <div className="answer">
                {item.a.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* English */}
      <section className="section container" lang="en" aria-labelledby="in-english">
        <div className="english glass">
          <h2 id="in-english">In English</h2>
          <p>
            Thaigit is a free, visual Git GUI with a Liquid Glass look: a colorful commit graph, drag-and-drop
            to merge, rebase or push, line-by-line staging and a friendly conflict resolver. The native macOS
            app is available today and updates itself from GitHub Releases. A Windows beta (Tauri 2, Windows
            10/11) is out too and also updates itself. The UI is Vietnamese for now.
          </p>
        </div>
      </section>

      {/* Kêu gọi cuối */}
      <section className="container">
        <div className="final-cta reveal">
          <h2>Làm việc với Git nhẹ nhàng hơn từ hôm nay</h2>
          <p>Tải Thaigit miễn phí cho macOS — và bản thử cho Windows.</p>
          <div className="cta">
            <DownloadButton initial={release} />
            <a className="btn btn-secondary" href={LINKS.github}>
              <GitHubIcon /> Mã nguồn trên GitHub
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
