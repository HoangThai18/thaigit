<!-- A file-type badge (see fileTypes.ts) drawn as SVG: a short label, or a glyph for images / lock files / unknown files. -->
<script lang="ts">
  import { fileTypeOf } from './fileTypes.ts';

  interface Props {
    path: string;
  }

  let { path }: Props = $props();

  const type = $derived(fileTypeOf(path));
  const small = $derived(type.label.length >= 3);
</script>

<svg class="file-type" width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
  <rect x="0.5" y="0.5" width="19" height="13" rx="3.2" fill={type.color} />
  {#if type.glyph === 'image'}
    <circle cx="7" cy="5" r="1.5" fill={type.ink} />
    <path d="M3.5 11l4-4.2 2.6 2.6 2.2-2 4.2 3.6z" fill={type.ink} />
  {:else if type.glyph === 'lock'}
    <rect x="6.6" y="6" width="6.8" height="5.2" rx="1" fill={type.ink} />
    <path d="M8 6V4.8a2 2 0 0 1 4 0V6" stroke={type.ink} stroke-width="1.3" fill="none" />
  {:else if type.glyph === 'doc'}
    <path
      d="M6 3h5.4L14 5.6V11H6z"
      fill="none"
      stroke={type.ink}
      stroke-width="1.2"
      stroke-linejoin="round"
    />
    <path d="M7.8 7.6h4.4M7.8 9.4h3" stroke={type.ink} stroke-width="1" stroke-linecap="round" />
  {:else}
    <text
      x="10"
      y="10.1"
      text-anchor="middle"
      fill={type.ink}
      font-size={small ? 6.4 : 7.6}
      font-weight="800"
      font-family="-apple-system, 'Segoe UI', system-ui, sans-serif"
      letter-spacing={small ? -0.2 : 0}>{type.label}</text
    >
  {/if}
</svg>

<style>
  .file-type {
    flex: none;
    vertical-align: middle;
  }
</style>
