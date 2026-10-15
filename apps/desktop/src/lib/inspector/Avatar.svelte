<!--
  An author's avatar: the real picture from the shared avatar store (the same images the graph nodes paint) when `email` is
  given and one exists, otherwise a circle with the initials, coloured by name (same formula as the Swift app).
-->
<script lang="ts">
  import { avatars } from '../graph/avatars.svelte.ts';
  import { initials } from '../graph/style.ts';
  import { avatarColorIndex } from './changes.ts';

  interface Props {
    name: string;
    email?: string | null;
    size?: number;
  }

  let { name, email = null, size = 28 }: Props = $props();

  const color = $derived(`var(--lane-${avatarColorIndex(name)})`);
  const picture = $derived.by(() => {
    void avatars.version;
    return email && avatars.enabled ? (avatars.image(email)?.src ?? null) : null;
  });

  $effect(() => {
    if (email) avatars.ensure(email);
  });
</script>

{#if picture}
  <img
    class="avatar"
    src={picture}
    alt=""
    width={size}
    height={size}
    style:width="{size}px"
    style:height="{size}px"
  />
{:else}
  <span
    class="avatar"
    style:width="{size}px"
    style:height="{size}px"
    style:background={color}
    style:font-size="{size * 0.38}px"
    aria-hidden="true"
  >
    {initials(name)}
  </span>
{/if}

<style>
  .avatar {
    display: inline-grid;
    flex: none;
    place-items: center;
    border-radius: 50%;
    color: #fff;
    font-weight: 700;
    line-height: 1;
    text-shadow: 0 0.5px 1px rgb(0 0 0 / 0.3);
    object-fit: cover;
  }
</style>
