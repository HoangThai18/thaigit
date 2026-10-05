<!--
  Cây nhánh theo "/" (port BranchTree/BranchFolder của SidebarView.swift). Chỉ dựng node đang mở: thư mục không mở thì cây
  con không tồn tại trong DOM; thư mục > 30 nhánh thu gọn sẵn; mỗi cấp tối đa 50 hàng + "Hiện thêm".
-->
<script lang="ts">
  import type { GitRef } from '@thaigit/core';
  import type { Snippet } from 'svelte';
  import { showBidi } from '../format/bidi.ts';
  import { vi } from '../strings.vi.ts';
  import Icon from '../ui/Icon.svelte';
  import BranchTree from './BranchTree.svelte';
  import LimitedRows from './LimitedRows.svelte';
  import './sidebar.css';
  import { folderStartsExpanded, type BranchNode } from './tree.ts';

  interface Props {
    nodes: readonly BranchNode[];
    depth?: number;
    /** One branch row: `(ref, display name, depth)`. */
    leaf: Snippet<[GitRef, string, number]>;
  }

  let { nodes, depth = 0, leaf }: Props = $props();

  /** Per-folder open/closed state at this level (key = node id, unique across sibling nodes). */
  let expanded = $state<Record<string, boolean>>({});

  const isOpen = (node: BranchNode): boolean => expanded[node.id] ?? folderStartsExpanded(node.leafCount);
  const indent = $derived(10 + depth * 14);
</script>

<LimitedRows items={nodes} noun={vi.sidebar.nounBranch} keyOf={(node) => node.id} {indent}>
  {#snippet row(node: BranchNode)}
    {#if node.ref}
      {@render leaf(node.ref, node.name, depth)}
    {:else}
      {@const open = isOpen(node)}
      <button
        type="button"
        class="sb-row"
        style:padding-left="{indent}px"
        aria-expanded={open}
        onclick={() => (expanded[node.id] = !open)}
      >
        <span class="sb-chevron"
          ><Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} strokeWidth={2.4} /></span
        >
        <span class="sb-icon"><Icon name="folder" size={15} /></span>
        <span class="sb-title"><bdi>{showBidi(node.name)}</bdi></span>
        {#if !open}<span class="sb-count">{node.leafCount}</span>{/if}
      </button>
      {#if open}
        <BranchTree nodes={node.children} depth={depth + 1} {leaf} />
      {/if}
    {/if}
  {/snippet}
</LimitedRows>
