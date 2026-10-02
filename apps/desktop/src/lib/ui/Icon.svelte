<!-- Biểu tượng nét 24×24, màu theo `currentColor`. Hình dạng là dữ liệu (icons.ts), không dùng {@html}. -->
<script lang="ts">
  import { ICONS, type IconName } from './icons.ts';

  interface Props {
    name: IconName;
    size?: number;
    strokeWidth?: number;
    class?: string;
  }

  let { name, size = 16, strokeWidth = 1.9, class: className = '' }: Props = $props();
</script>

<svg
  class="icon {className}"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#each ICONS[name] as shape, index (index)}
    {#if 'd' in shape}
      <path
        d={shape.d}
        fill={shape.fill ? 'currentColor' : 'none'}
        stroke={shape.fill ? 'none' : undefined}
      />
    {:else if 'circle' in shape}
      <circle
        cx={shape.circle[0]}
        cy={shape.circle[1]}
        r={shape.circle[2]}
        fill={shape.fill ? 'currentColor' : 'none'}
        stroke={shape.fill ? 'none' : undefined}
      />
    {:else}
      <rect
        x={shape.rect[0]}
        y={shape.rect[1]}
        width={shape.rect[2]}
        height={shape.rect[3]}
        rx={shape.rect[4]}
      />
    {/if}
  {/each}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
