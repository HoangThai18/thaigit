import Link from 'next/link';
import { Compare } from '@/components/Compare';
import { CopyCode } from '@/components/CopyCode';
import { Effects } from '@/components/Effects';
import { Faq } from '@/components/Faq';
import { FeatureTabs } from '@/components/FeatureTabs';
import { GuideCard } from '@/components/GuideCard';
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
import { DownloadCount } from '@/components/DownloadCount';
import { DownloadButton, ReleaseDetails } from '@/components/ReleaseInfo';
import { JsonLd } from '@/components/Seo';
import { Shot, ThemedShot } from '@/components/Shot';
import { formatDate, readChangelog } from '@/lib/changelog';
import { FAQ, FEATURES, SMALL_FEATURES, type SmallFeature } from '@/lib/content';
import { GUIDES } from '@/lib/guides';
import { HOME } from '@/lib/home-text';
import { PATHS, type Lang } from '@/lib/i18n';
import { fetchMacRelease } from '@/lib/release';
import { LINKS, SITE, SITE_TEXT } from '@/lib/site';
import { UI } from '@/lib/ui';

const ICONS: Record<SmallFeature['icon'], () => React.ReactElement> = {
  split: () => <SplitIcon />,
  undo: () => <UndoIcon />,
  refresh: () => <RefreshIcon />,
  moon: () => <MoonIcon />,
  shield: () => <ShieldIcon />,
  keyboard: () => <KeyboardIcon />,
};

const RELEASE_ITEMS = 4;
const HOME_GUIDES = 6;

export async function HomePage({ lang }: { lang: Lang }) {
  const text = HOME[lang];
  const ui = UI[lang];
  const faq = FAQ[lang];
  const showChangelog = lang === 'vi';
  const [release, changelog] = await Promise.all([
    fetchMacRelease({ cache: 'force-cache' }),
    showChangelog ? readChangelog(3) : Promise.resolve([]),
  ]);

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE.name,
      description: SITE_TEXT[lang].description,
      url: `${SITE.url}${PATHS.home[lang]}`,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS 14+, Windows 10/11',
      downloadUrl: LINKS.downloadMac,
      ...(release ? { softwareVersion: release.version } : {}),
      image: `${SITE.url}/logo-256.png`,
      screenshot: `${SITE.url}/screenshots/overview-1600.webp`,
      inLanguage: lang,
      offers: { '@type': 'Offer', price: '0', priceCurrency: lang === 'vi' ? 'VND' : 'USD' },
      author: { '@type': 'Person', name: SITE.author },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a.join(' ') },
      })),
    },
  ];

  return (
    <>
      <JsonLd data={structuredData} />
      <Effects />

      <section className="hero">
        <div className="hero-bg" aria-hidden="true">
          <div className="orb orb-orange" />
          <div className="orb orb-blue" />
          <div className="grid-lines" />
        </div>

        <div className="hero-inner container">
          <span className="eyebrow">
            <span className="pulse-dot" aria-hidden="true" />
            {text.hero.eyebrow}
          </span>
          <h1>
            {text.hero.titleLine}
            <br />
            <span className="gradient-text">{text.hero.titleGradient}</span>
          </h1>
          <p className="lead">{text.hero.lead}</p>
          <div className="cta">
            <DownloadButton initial={release} />
            <a className="btn btn-glass" href={LINKS.downloadWindows} title={ui.download.winTitle}>
              <WindowsIcon />
              <span className="btn-stack">
                {ui.download.win}
                <span className="sub">{ui.download.winSub}</span>
              </span>
            </a>
          </div>
          <div className="checks-row">
            {text.hero.checks.map((check) => (
              <span key={check}>{check}</span>
            ))}
            <DownloadCount />
          </div>

          <div className="hero-stage">
            <div className="hero-glow" aria-hidden="true" />
            <div className="hero-frame" data-tilt>
              <div className="beam" aria-hidden="true" />
              <div className="hero-frame-inner">
                <ThemedShot
                  light="overview"
                  dark="overview-dark"
                  lang={lang}
                  priority
                  sizes="(max-width: 1140px) 100vw, 1100px"
                />
              </div>
            </div>
            <div className="float-badge b1" aria-hidden="true">
              <span className="dot" />
              {text.hero.badges.drag}
            </div>
            <div className="float-badge b2" aria-hidden="true">
              <span className="dot" />
              {text.hero.badges.switch}
              <kbd>⌘B</kbd>
            </div>
            <div className="float-badge b3" aria-hidden="true">
              <span className="dot" />
              {text.hero.badges.stage}
            </div>
          </div>

          <div className="stats">
            {text.hero.stats.map((stat) => (
              <div key={stat.value} className={`stat${stat.warm ? ' warm' : ''}`} data-spot data-reveal>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="tinh-nang" className="section container">
        <div className="section-head" data-reveal>
          <span className="kicker">{text.features.kicker}</span>
          <h2>{text.features.title}</h2>
          <p>{text.features.text}</p>
        </div>

        <FeatureTabs features={FEATURES[lang]} />

        <div className="cards">
          {SMALL_FEATURES[lang].map((feature) => (
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

      <section className="section container" aria-labelledby="giao-dien-tieu-de">
        <div className="section-head" data-reveal>
          <span className="kicker">{text.look.kicker}</span>
          <h2 id="giao-dien-tieu-de">{text.look.title}</h2>
        </div>
        <div className="window" data-reveal>
          <Compare />
        </div>
        <div className="gallery">
          {text.gallery.map((item) => (
            <figure key={item.shot} data-reveal>
              <div className="frame">
                <Shot name={item.shot} lang={lang} sizes="(max-width: 700px) 100vw, 380px" />
                <figcaption>{item.caption}</figcaption>
              </div>
            </figure>
          ))}
        </div>
      </section>

      <section id="tai-ve" className="section container">
        <div className="section-head" data-reveal>
          <span className="kicker">{text.download.kicker}</span>
          <h2>{text.download.title}</h2>
          <p>{text.download.text}</p>
        </div>
        <div className="downloads">
          <div className="dl-ring" data-os="mac" data-reveal>
            <div className="dl-card">
              <div className="dl-card-head">
                <h3>
                  <AppleIcon size={24} /> macOS
                </h3>
                <span className="fit-badge">{text.download.fit}</span>
              </div>
              <p className="meta">{text.download.macMeta}</p>
              <DownloadButton initial={release} className="btn btn-primary btn-block" />
              <ol className="steps">
                <li>{text.download.macSteps.first}</li>
                <li>{text.download.macSteps.second}</li>
                <li>
                  <span>
                    {text.download.macSteps.third} <strong>{text.download.openAnyway}</strong>.
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
                <span className="fit-badge">{text.download.fit}</span>
              </div>
              <p className="meta">{text.download.winMeta}</p>
              <a className="btn btn-primary btn-block" href={LINKS.downloadWindows}>
                <WindowsIcon /> {text.download.winButton}
              </a>
              <ol className="steps">
                <li>
                  <span>
                    {text.download.winSteps.git}{' '}
                    <a href={LINKS.gitForWindows}>{text.download.gitForWindows}</a>.
                  </span>
                </li>
                <li>{text.download.winSteps.install}</li>
                <li>
                  <span>
                    {text.download.winSteps.smartScreen} <strong>{text.download.moreInfo}</strong> →{' '}
                    <strong>{text.download.runAnyway}</strong>.
                  </span>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      {changelog.length > 0 && (
        <section id="co-gi-moi" className="section container">
          <div className="section-head" data-reveal>
            <span className="kicker">{text.changelog.kicker}</span>
            <h2>{text.changelog.title}</h2>
          </div>
          <div className="lanes">
            {changelog.map((lane) => {
              const os = lane.platform === 'Windows' ? 'win' : 'mac';
              return (
                <div key={lane.platform} className="lane" data-os={os}>
                  <header className="lane-head" data-reveal>
                    <span className="lane-icon">
                      {lane.platform === 'Windows' ? <WindowsIcon size={18} /> : <AppleIcon size={18} />}
                    </span>
                    <div>
                      <h3>{lane.platform === 'Windows' ? text.platforms.windows : text.platforms.mac}</h3>
                      <span>
                        {text.changelog.latest} {lane.entries[0].version}
                      </span>
                    </div>
                  </header>
                  <div className="timeline">
                    {lane.entries.map((entry) => {
                      const shown = entry.items.slice(0, RELEASE_ITEMS);
                      const more = entry.items.slice(RELEASE_ITEMS);
                      return (
                        <article key={entry.version} className="release" data-os={os} data-reveal>
                          <div className="release-body">
                            <header>
                              <h4>{entry.version}</h4>
                              {entry.date && (
                                <time dateTime={entry.date}>{formatDate(entry.date, lang)}</time>
                              )}
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
                                <summary>{text.changelog.more(more.length)}</summary>
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
                </div>
              );
            })}
          </div>
          <p className="section-more">
            <Link href={PATHS.changelog[lang]}>{text.changelog.all}</Link>
          </p>
        </section>
      )}

      <section id="huong-dan" className="section container">
        <div className="section-head" data-reveal>
          <span className="kicker">{text.guides.kicker}</span>
          <h2>{text.guides.title}</h2>
          <p>{text.guides.text}</p>
        </div>
        <ul className="gcards" data-reveal>
          {GUIDES.slice(0, HOME_GUIDES).map((guide) => (
            <li key={guide.id}>
              <GuideCard guide={guide} lang={lang} />
            </li>
          ))}
        </ul>
        <p className="section-more">
          <Link href={PATHS.guides[lang]}>{ui.allGuides(GUIDES.length)}</Link>
        </p>
      </section>

      <section id="hoi-dap" className="section narrow container">
        <div className="section-head" data-reveal>
          <span className="kicker">{text.faq.kicker}</span>
          <h2>{text.faq.title}</h2>
        </div>
        <Faq items={faq} />
      </section>

      {text.english && (
        <section className="section tight narrow container" lang="en" aria-labelledby="in-english">
          <div className="english" data-reveal>
            <h2 id="in-english">{text.english.title}</h2>
            <p>{text.english.text}</p>
          </div>
        </section>
      )}

      <section className="section tight container">
        <div className="final-cta" data-reveal>
          <img src="/logo-256.png" width={88} height={88} alt="" />
          <h2>{text.finalCta.title}</h2>
          <p>{text.finalCta.text}</p>
          <div className="cta">
            <DownloadButton initial={release} className="btn btn-white" />
            <a className="btn btn-outline-light" href={LINKS.downloadWindows} title={ui.download.winTitle}>
              <WindowsIcon />
              <span className="btn-stack">
                {ui.download.win}
                <span className="sub">{ui.download.winSub}</span>
              </span>
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
