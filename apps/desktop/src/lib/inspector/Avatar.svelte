<!-- Vòng tròn chữ cái đầu của tác giả; màu theo tên (cùng công thức với app Swift). -->
<script lang="ts">
  import { initials } from '../graph/style.ts';
  import { avatarColorIndex } from './changes.ts';

  interface Props {
    name: string;
    size?: number;
  }

  let { name, size = 28 }: Props = $props();

  const color = $derived(`var(--lane-${avatarColorIndex(name)})`);
</script>

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
  }
</style>
