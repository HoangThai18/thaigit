<!--
  Dải cảnh báo trên panel thay đổi: các cờ rủi ro (xoá / bỏ qua test, đổi thư viện, CI, file lớn, bí mật) kèm tên file — không
  bao giờ hiện nội dung bí mật. Chỉ là cảnh báo, không chặn commit.
-->
<script lang="ts">
  import type { RiskCode, RiskFlag } from '@thaigit/core';
  import { showBidi } from '../format/bidi.ts';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    flags: readonly RiskFlag[];
    /** The ✕ button: hide the strip until a new flag appears. */
    ondismiss?: () => void;
  }

  let { flags, ondismiss }: Props = $props();

  const SHOWN = 3;

  function label(code: RiskCode, count: number): string {
    switch (code) {
      case 'tests-removed':
        return vi.risk.testsRemoved(count);
      case 'tests-skipped':
        return vi.risk.testsSkipped(count);
      case 'deps-changed':
        return vi.risk.depsChanged(count);
      case 'ci-changed':
        return vi.risk.ciChanged(count);
      case 'large-file':
        return vi.risk.largeFile(count);
      case 'secret':
        return vi.risk.secret(count);
    }
  }

  function files(flag: RiskFlag): string {
    const shown = flag.paths.slice(0, SHOWN).join(', ');
    const rest = flag.paths.length - SHOWN;
    return rest > 0 ? `${shown} ${vi.risk.more(rest)}` : shown;
  }
</script>

{#if flags.length > 0}
  <div class="risks" role="status" title={vi.risk.hint}>
    <div class="title">
      <Icon name="warning" size={14} />
      <span>{vi.risk.title}</span>
      {#if ondismiss}
        <button
          type="button"
          class="close"
          title={vi.risk.dismiss}
          aria-label={vi.risk.dismiss}
          onclick={ondismiss}
        >
          <Icon name="x" size={12} />
        </button>
      {/if}
    </div>
    <ul>
      {#each flags as flag (flag.code)}
        <li class:danger={flag.code === 'secret'}>
          <strong>{label(flag.code, flag.paths.length)}</strong>
          <span class="files"><bdi>{showBidi(files(flag))}</bdi></span>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .close {
    display: inline-grid;
    place-items: center;
    margin-left: auto;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .close:hover {
    background: var(--row-hover);
    color: var(--text);
  }

  .risks {
    flex: none;
    margin: 0 10px 8px;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
    border-radius: var(--radius-s);
    background: color-mix(in srgb, var(--warning) 12%, transparent);
    font-size: 12px;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }

  .title :global(svg) {
    color: var(--warning);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 6px 0 0;
    padding: 0 0 0 20px;
  }

  li {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  li.danger strong {
    color: var(--danger);
  }

  strong {
    font-weight: 500;
  }

  .files {
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
