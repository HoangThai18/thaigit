<!--
  The "What's New" tab, like the Swift 1.x app and GitKraken's Release Notes: one card per version from the bundled
  CHANGELOG.md, the running version marked, plus "Check for updates".
-->
<script lang="ts">
  import logo from '../assets/logo.png';
  import { hasTauriInternals } from '../platform/host.ts';
  import { bundledNotes, inlineSegments } from '../release/notes.ts';
  import { vi } from '../strings.vi.ts';
  import { updates } from '../stores/update.svelte.ts';

  const version = import.meta.env.VITE_APP_VERSION ?? '';
  const inApp = hasTauriInternals();
</script>

<main class="notes">
  <div class="column">
    <header class="head">
      <img src={logo} alt="" width="56" height="56" />
      <div class="titles">
        <h1><span class="brand">{vi.update.notes}</span></h1>
        {#if version}<p>{vi.update.youAreOn(version)}</p>{/if}
      </div>
      {#if inApp}
        {#if updates.available}
          <button type="button" class="check" onclick={() => void updates.install()}>
            {vi.update.installMenu(updates.available.version)}
          </button>
        {:else}
          <button
            type="button"
            class="check"
            disabled={updates.checking || updates.installing}
            onclick={() => void updates.check(version)}>{vi.update.checkButton}</button
          >
        {/if}
      {/if}
    </header>

    {#if bundledNotes.length === 0}
      <div class="empty glass">
        <strong>{vi.update.notesEmptyTitle}</strong>
        <span>{vi.update.notesEmpty}</span>
      </div>
    {:else}
      {#each bundledNotes as section, index (index)}
        <section class="card glass">
          <div class="card-head">
            <h2>{section.isUnreleased ? section.title : vi.update.sectionTitle(section.title)}</h2>
            {#if section.title === version}<span class="badge current">{vi.update.currentBadge}</span>{/if}
            {#if section.isUnreleased}<span class="badge dev">{vi.update.unreleasedBadge}</span>{/if}
            <span class="grow"></span>
            {#if section.date}<span class="date">{section.date}</span>{/if}
          </div>
          {#each section.paragraphs as paragraph, p (p)}
            <p class="paragraph">
              {#each inlineSegments(paragraph) as segment, s (s)}
                {#if segment.style === 'bold'}<strong>{segment.text}</strong
                  >{:else if segment.style === 'code'}<code>{segment.text}</code>{:else}{segment.text}{/if}
              {/each}
            </p>
          {/each}
          <ul>
            {#each section.items as item, i (i)}
              <li>
                {#each inlineSegments(item) as segment, s (s)}
                  {#if segment.style === 'bold'}<strong>{segment.text}</strong
                    >{:else if segment.style === 'code'}<code>{segment.text}</code>{:else}{segment.text}{/if}
                {/each}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  </div>
</main>

<style>
  .notes {
    height: 100%;
    overflow-y: auto;
    user-select: text;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 780px;
    margin: 0 auto;
    padding: 36px 24px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .titles {
    flex: 1;
    min-width: 0;
  }

  h1 {
    margin: 0;
    font-size: 30px;
  }

  .brand {
    background: linear-gradient(90deg, var(--brand-orange), var(--brand-blue));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .titles p {
    margin: 2px 0 0;
    color: var(--text-secondary);
  }

  .check {
    flex: none;
    padding: 7px 14px;
    border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    border-radius: 10px;
    background: var(--glass-fill);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .check:hover:not(:disabled) {
    background: var(--row-hover);
  }

  .check:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .card,
  .empty {
    padding: 18px;
    border-radius: 18px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text-secondary);
  }

  .card-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 8px;
  }

  h2 {
    margin: 0;
    font-size: 20px;
  }

  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 600;
  }

  .badge.current {
    background: color-mix(in srgb, var(--brand-blue) 15%, transparent);
    color: var(--brand-blue);
  }

  .badge.dev {
    background: color-mix(in srgb, var(--brand-orange) 15%, transparent);
    color: var(--brand-orange);
  }

  .grow {
    flex: 1;
  }

  .date {
    color: var(--text-secondary);
    font-size: 13px;
  }

  .paragraph {
    margin: 0 0 8px;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    position: relative;
    padding-left: 16px;
    line-height: 1.5;
  }

  li::before {
    position: absolute;
    left: 2px;
    color: var(--brand-blue);
    font-weight: 700;
    content: '•';
  }

  code {
    padding: 0 4px;
    border-radius: 4px;
    background: var(--chip-fill);
    font-family: var(--font-mono);
    font-size: 0.92em;
  }
</style>
