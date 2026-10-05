<!--
  Chỉ dựng một phần danh sách dài (50 hàng đầu); phần còn lại hiện thêm 200 hàng mỗi lần bấm "Hiện thêm…"
  (port LimitedRows của SidebarView.swift) — repo hàng nghìn nhánh không bao giờ dựng hàng nghìn hàng một lúc.
-->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';
  import './sidebar.css';
  import { PAGE_SIZE, PAGE_STEP, nextPage } from './tree.ts';

  interface Props {
    items: readonly T[];
    /** The noun in "Show 200 more branches (627 left)". */
    noun: string;
    keyOf: (item: T) => string;
    row: Snippet<[T]>;
    /** Indent of the "Show more" button (px) so it lines up with the tree level. */
    indent?: number;
  }

  let { items, noun, keyOf, row, indent = 10 }: Props = $props();

  let limit = $state(PAGE_SIZE);
  const shown = $derived(items.slice(0, limit));
  const more = $derived(nextPage(items.length, limit));
</script>

{#each shown as item (keyOf(item))}
  {@render row(item)}
{/each}
{#if more.remaining > 0}
  <button
    type="button"
    class="sb-row sb-more"
    style:padding-left="{indent}px"
    onclick={() => (limit += PAGE_STEP)}
  >
    <span class="sb-icon"><Icon name="plus" size={13} /></span>
    {vi.sidebar.showMore(more.step, noun, more.remaining)}
  </button>
{/if}
