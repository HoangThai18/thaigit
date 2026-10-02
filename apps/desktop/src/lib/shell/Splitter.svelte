<!-- Thanh kéo đổi độ rộng panel (sidebar / inspector). Con trỏ được "bắt" nên kéo ra ngoài thanh vẫn mượt; hỗ trợ bàn phím. -->
<script lang="ts">
  interface Props {
    /** Độ rộng hiện tại của panel (px). */
    value: number;
    min: number;
    max: number;
    /** `left`: panel nằm bên trái thanh (kéo sang phải thì rộng ra); `right`: panel bên phải. */
    side: 'left' | 'right';
    label: string;
    onchange: (width: number) => void;
  }

  let { value, min, max, side, label, onchange }: Props = $props();

  let drag: { startX: number; startValue: number } | null = null;

  const clamp = (width: number): number => Math.min(max, Math.max(min, Math.round(width)));

  function begin(event: PointerEvent): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { startX: event.clientX, startValue: value };
    event.preventDefault();
  }

  function move(event: PointerEvent): void {
    if (!drag) return;
    const delta = event.clientX - drag.startX;
    onchange(clamp(drag.startValue + (side === 'left' ? delta : -delta)));
  }

  function end(): void {
    drag = null;
  }

  function key(event: KeyboardEvent): void {
    const step = event.shiftKey ? 40 : 12;
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === grow) onchange(clamp(value + step));
    else if (event.key === shrink) onchange(clamp(value - step));
    else return;
    event.preventDefault();
  }
</script>

<!-- Thanh chia có thể focus (mẫu "window splitter" của WAI-ARIA): Svelte coi `separator` là phần tử tĩnh nên cần bỏ qua cảnh báo. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="splitter"
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  aria-valuenow={value}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  onpointerdown={begin}
  onpointermove={move}
  onpointerup={end}
  onpointercancel={end}
  onlostpointercapture={end}
  onkeydown={key}
></div>

<style>
  .splitter {
    position: relative;
    flex: none;
    width: 1px;
    background: var(--separator);
    z-index: 5;
    touch-action: none;
  }

  /* Vùng bấm rộng hơn vạch kẻ. */
  .splitter::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: -4px;
    right: -4px;
    cursor: col-resize;
  }

  .splitter:hover,
  .splitter:focus-visible {
    background: var(--accent);
  }
</style>
