<!--
  Hộp "Góp ý & báo lỗi": chọn loại, viết nội dung, tuỳ chọn kèm phiên bản app + hệ điều hành, rồi mở ứng dụng email với
  thư soạn sẵn (người dùng tự bấm gửi). Không có ứng dụng email thì chép nội dung để dán tay.
-->
<script lang="ts">
  import { openUrl } from '../ipc/os.ts';
  import { feedback as defaultStore, type FeedbackStore } from '../stores/feedback.svelte.ts';
  import { buildTarget } from '../stores/telemetry.svelte.ts';
  import { toasts } from '../stores/toasts.svelte.ts';
  import { vi } from '../strings.vi.ts';
  import { FEEDBACK_EMAIL, feedbackBody, feedbackMailto, type FeedbackDraft } from './compose.ts';

  interface Props {
    store?: FeedbackStore;
    version?: string;
    system?: string | null;
    openMail?: (url: string) => Promise<void>;
    copy?: (text: string) => Promise<void>;
  }

  const target = buildTarget();
  let {
    store = defaultStore,
    version = import.meta.env.VITE_APP_VERSION ?? '',
    system = target === null ? null : `${target.platform === 'macos' ? 'macOS' : 'Windows'} (${target.arch})`,
    openMail = (url: string) => openUrl(url, true),
    copy = (text: string) => navigator.clipboard.writeText(text),
  }: Props = $props();

  const text = vi.feedback;
  let message = $state('');
  let includeInfo = $state(true);
  let field = $state<HTMLTextAreaElement | null>(null);

  $effect(() => {
    if (store.isOpen && field) field.focus();
  });

  function info(): string | null {
    if (!includeInfo) return null;
    const lines = [version && text.infoVersion(version), system && text.infoSystem(system)].filter(Boolean);
    return lines.length === 0 ? null : lines.join('\n');
  }

  function draft(): FeedbackDraft | null {
    if (message.trim() === '') {
      toasts.warning(text.empty);
      field?.focus();
      return null;
    }
    return { kind: store.kind, message, info: info() };
  }

  async function send(): Promise<void> {
    const current = draft();
    if (current === null) return;
    const { url } = feedbackMailto(current, { subject: text.subject, trimmed: text.trimmed });
    try {
      await openMail(url);
    } catch (error) {
      toasts.error(text.openFailed(FEEDBACK_EMAIL), error);
      return;
    }
    toasts.success(text.opened);
    message = '';
    store.close();
  }

  async function copyBody(): Promise<void> {
    const current = draft();
    if (current === null) return;
    try {
      await copy(`${text.subject(current.kind)}\n\n${feedbackBody(current)}`);
    } catch (error) {
      toasts.error(text.copyFailed, error);
      return;
    }
    toasts.success(text.copied(FEEDBACK_EMAIL));
  }

  function onwindowkeydown(event: KeyboardEvent): void {
    if (!store.isOpen || event.key !== 'Escape') return;
    event.preventDefault();
    store.close();
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

{#if store.isOpen}
  <div class="backdrop" role="presentation" onclick={() => store.close()}>
    <div
      class="dialog glass"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') store.close();
      }}
    >
      <h2 id="feedback-title">{text.title}</h2>
      <p class="help">{text.intro(FEEDBACK_EMAIL)}</p>
      <div class="kinds" role="radiogroup" aria-label={text.kind}>
        <label>
          <input type="radio" name="feedback-kind" value="bug" bind:group={store.kind} />
          <span>{text.kindBug}</span>
        </label>
        <label>
          <input type="radio" name="feedback-kind" value="idea" bind:group={store.kind} />
          <span>{text.kindIdea}</span>
        </label>
      </div>
      <label class="field">
        <span>{text.message}</span>
        <textarea
          rows="7"
          bind:this={field}
          bind:value={message}
          placeholder={store.kind === 'bug' ? text.placeholderBug : text.placeholderIdea}></textarea>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={includeInfo} />
        <span>{text.includeInfo}</span>
      </label>
      <p class="help">{text.noRepoData}</p>
      <div class="buttons">
        <button type="button" class="button" onclick={() => store.close()}>{text.cancel}</button>
        <button type="button" class="button" onclick={() => void copyBody()}>{text.copy}</button>
        <button type="button" class="button primary" onclick={() => void send()}>{text.send}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 860;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.28);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(520px, calc(100vw - 48px));
    max-height: calc(100vh - 64px);
    overflow: auto;
    padding: 18px 22px;
    border-radius: var(--radius-l);
    background: var(--surface);
    box-shadow: var(--glass-shadow);
    outline: none;
  }

  h2 {
    margin: 0;
    font-size: 16px;
  }

  .help {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.45;
  }

  .kinds {
    display: flex;
    gap: 18px;
    font-size: 13px;
  }

  .kinds label,
  .check {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 13px;
  }

  .check input {
    margin-top: 2px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 13px;
  }

  textarea {
    resize: vertical;
    min-height: 110px;
    padding: 7px 9px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    line-height: 1.45;
  }

  textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .button {
    padding: 5px 14px;
    border: 1px solid var(--field-border);
    border-radius: var(--radius-s);
    background: var(--field-fill);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .button.primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
