<!--
  Diff ảnh: bản cũ | bản mới cạnh nhau (kèm kích thước, dung lượng) trên nền ô bàn cờ để thấy vùng trong suốt. File nhị phân
  không phải ảnh thì chỉ báo "file nhị phân". Ảnh hiện qua blob: URL (CSP img-src cho phép), thu hồi khi đổi file.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { vi } from '../strings.vi.ts';
  import type { OpenFile } from '../stores/diff.svelte.ts';
  import type { RepoStore } from '../stores/repo.svelte.ts';
  import { formatBytes, imageType, loadImagePair, type ImageSide } from './images.ts';

  interface Props {
    store: RepoStore;
    file: OpenFile;
  }

  let { store, file }: Props = $props();

  interface Shown {
    url: string | null;
    side: ImageSide;
    width: number;
    height: number;
  }

  const type = $derived(imageType(file.change.path));
  let sides = $state<{ old: Shown; new: Shown } | null>(null);

  function toShown(side: ImageSide, mime: string): Shown {
    const url =
      side.kind === 'bytes' ? URL.createObjectURL(new Blob([side.bytes as BlobPart], { type: mime })) : null;
    return { url, side, width: 0, height: 0 };
  }

  $effect(() => {
    const current = file;
    const mime = type;
    if (mime === null) return;
    let cancelled = false;
    let made: Shown[] = [];
    sides = null;
    // Reload only when the file changes (a status that refreshes constantly must not make the image flicker).
    const context = untrack(() => ({ headOid: store.headOid, stashes: store.stashes }));
    void loadImagePair(store.git, current.source, current.change, context).then((pair) => {
      if (cancelled) return;
      made = [toShown(pair.old, mime), toShown(pair.new, mime)];
      sides = { old: made[0] as Shown, new: made[1] as Shown };
    });
    return () => {
      cancelled = true;
      for (const shown of made) if (shown.url) URL.revokeObjectURL(shown.url);
    };
  });

  function measured(which: 'old' | 'new', event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    if (!sides) return;
    sides = {
      ...sides,
      [which]: { ...sides[which], width: image.naturalWidth, height: image.naturalHeight },
    };
  }
</script>

{#snippet panel(which: 'old' | 'new', shown: Shown)}
  <figure class="side {which}">
    <figcaption>{which === 'old' ? vi.staging.imageOld : vi.staging.imageNew}</figcaption>
    <div class="canvas">
      {#if shown.url}
        <img
          src={shown.url}
          alt={which === 'old' ? vi.staging.imageOld : vi.staging.imageNew}
          onload={(event) => measured(which, event)}
        />
      {:else}
        <span class="placeholder">
          {shown.side.kind === 'tooLarge'
            ? vi.staging.imageTooLarge
            : shown.side.kind === 'failed'
              ? vi.staging.imageFailed
              : vi.staging.imageNone}
        </span>
      {/if}
    </div>
    {#if shown.side.kind === 'bytes' && shown.width > 0}
      <span class="meta"
        >{vi.staging.imageSize(shown.width, shown.height, formatBytes(shown.side.bytes.length))}</span
      >
    {/if}
  </figure>
{/snippet}

{#if type === null}
  <p class="message">{vi.staging.binary}</p>
{:else if sides === null}
  <p class="message">{vi.staging.loading}</p>
{:else}
  <div class="images">
    {@render panel('old', sides.old)}
    {@render panel('new', sides.new)}
  </div>
{/if}

<style>
  .message {
    margin: 0;
    padding: 40px 24px;
    color: var(--text-secondary);
    font-size: 13px;
    text-align: center;
  }

  .images {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    height: 100%;
    box-sizing: border-box;
    padding: 16px;
    overflow: auto;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    margin: 0;
  }

  figcaption {
    font-size: 12px;
    font-weight: 600;
  }

  .old figcaption {
    color: var(--danger);
  }

  .new figcaption {
    color: var(--success);
  }

  .canvas {
    display: grid;
    place-items: center;
    flex: 1;
    min-height: 120px;
    padding: 12px;
    border: 1px solid var(--separator);
    border-radius: var(--radius-m);
    background-color: var(--surface);
    background-image:
      linear-gradient(45deg, var(--surface-muted) 25%, transparent 25%),
      linear-gradient(-45deg, var(--surface-muted) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--surface-muted) 75%),
      linear-gradient(-45deg, transparent 75%, var(--surface-muted) 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
  }

  img {
    max-width: 100%;
    max-height: 60vh;
    object-fit: contain;
    image-rendering: auto;
  }

  .placeholder {
    color: var(--text-tertiary);
    font-size: 12.5px;
  }

  .meta {
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
</style>
