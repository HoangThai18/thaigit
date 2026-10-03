<!--
  Vẽ markdown của AI bằng allow-list (`markdown.ts`): chỉ chữ, không {@html}, không link bấm được, không ảnh.
-->
<script lang="ts">
  import { parseMarkdown, type Inline } from './markdown.ts';

  interface Props {
    text: string;
  }

  let { text }: Props = $props();

  const blocks = $derived(parseMarkdown(text));
</script>

{#snippet inline(parts: Inline[])}
  {#each parts as part, index (index)}
    {#if part.kind === 'bold'}<strong>{part.text}</strong>{:else if part.kind === 'italic'}<em>{part.text}</em
      >{:else if part.kind === 'code'}<code>{part.text}</code>{:else}{part.text}{/if}
  {/each}
{/snippet}

<div class="markdown selectable">
  {#each blocks as block, index (index)}
    {#if block.kind === 'heading'}
      <p class="heading h{block.level}">{@render inline(block.inlines)}</p>
    {:else if block.kind === 'item'}
      <p class="item" style:padding-left="{14 + block.depth * 14}px">
        <span class="marker">{block.marker}</span>{@render inline(block.inlines)}
      </p>
    {:else if block.kind === 'code'}
      <pre>{block.text}</pre>
    {:else}
      <p>{@render inline(block.inlines)}</p>
    {/if}
  {/each}
</div>

<style>
  .markdown {
    font-size: 13px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  p {
    margin: 0 0 8px;
  }

  .heading {
    margin: 12px 0 6px;
    font-weight: 650;
  }

  .heading:first-child {
    margin-top: 0;
  }

  .h1 {
    font-size: 15px;
  }

  .h2 {
    font-size: 14px;
  }

  .h3 {
    font-size: 13px;
  }

  .item {
    position: relative;
    margin-bottom: 4px;
  }

  .marker {
    position: absolute;
    margin-left: -14px;
    color: var(--text-tertiary);
  }

  code,
  pre {
    font-family: var(--font-mono);
    font-size: 12px;
  }

  code {
    padding: 0 3px;
    border-radius: 4px;
    background: var(--chip-fill);
  }

  pre {
    margin: 0 0 8px;
    padding: 8px;
    overflow: auto;
    border-radius: var(--radius-s);
    background: var(--field-fill);
  }
</style>
