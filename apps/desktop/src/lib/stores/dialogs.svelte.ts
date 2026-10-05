// Shared dialogs (like the Swift app's `Confirmation` and its small sheets): one dialog at a time, the result delivered via a Promise.
// Two kinds: a confirmation (primary / secondary / Cancel) and a short form (text field, select, checkbox — naming a branch, pushing to a
// remote…). Only plain text is ever rendered (no HTML), because the content can contain branch names / file names the repo chose.

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmTitle: string;
  /** A red confirm button (delete, discard changes, force push…). */
  destructive?: boolean;
  /** A second button between the primary one and "Cancel" (e.g. "Revert, don't commit"). */
  secondaryTitle?: string;
}

/** The result: 'confirm' (primary), 'secondary' (the second button), 'cancel' (Cancel / Esc / click outside). */
export type ConfirmResult = 'confirm' | 'secondary' | 'cancel';

export type FormField =
  | {
      readonly kind: 'text';
      readonly id: string;
      readonly label: string;
      readonly value: string;
      readonly placeholder?: string;
      /** A single-line field (a branch name, a SHA…). */
      readonly monospace?: boolean;
    }
  | {
      /** A multi-line field (a commit message…): Enter inserts a newline, Ctrl / ⌘ + Enter confirms. */
      readonly kind: 'multiline';
      readonly id: string;
      readonly label: string;
      readonly value: string;
      readonly placeholder?: string;
    }
  | {
      /** A masked field (a password, a passphrase): no autofill, no spell check. */
      readonly kind: 'password';
      readonly id: string;
      readonly label: string;
      readonly value: string;
      readonly placeholder?: string;
    }
  | {
      readonly kind: 'select';
      readonly id: string;
      readonly label: string;
      readonly value: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
    }
  | { readonly kind: 'checkbox'; readonly id: string; readonly label: string; readonly value: boolean };

export type FormValues = Readonly<Record<string, string | boolean>>;

export interface FormRequest {
  title: string;
  message?: string;
  fields: readonly FormField[];
  confirmTitle: string;
  destructive?: boolean;
  /** An error shown below the form (`null` = valid); while it is set the primary button is disabled. It re-runs on every edit, so it must be fast and must not call git. */
  validate?: (values: FormValues) => string | null;
}

export type PendingDialog =
  | (ConfirmRequest & {
      readonly kind: 'confirm';
      readonly id: number;
      readonly resolve: (result: ConfirmResult) => void;
    })
  | (FormRequest & {
      readonly kind: 'form';
      readonly id: number;
      readonly resolve: (values: FormValues | null) => void;
    });

/** The text value of a form field (trimmed at both ends). */
export function textValue(values: FormValues, id: string): string {
  const value = values[id];
  return typeof value === 'string' ? value.trim() : '';
}

export function flagValue(values: FormValues, id: string): boolean {
  return values[id] === true;
}

export class DialogStore {
  current = $state.raw<PendingDialog | null>(null);
  private serial = 0;

  /** Show a confirmation; an already-open dialog is dismissed as if Cancel had been pressed. */
  ask(request: ConfirmRequest): Promise<ConfirmResult> {
    this.dismiss();
    return new Promise((resolve) => {
      this.current = { ...request, kind: 'confirm', id: ++this.serial, resolve };
    });
  }

  /** Like `ask`, for when only "was the primary button pressed" matters. */
  async confirm(request: ConfirmRequest): Promise<boolean> {
    return (await this.ask(request)) === 'confirm';
  }

  /** Show a form; returns the field values on the primary button, `null` on cancel. */
  form(request: FormRequest): Promise<FormValues | null> {
    this.dismiss();
    return new Promise((resolve) => {
      this.current = { ...request, kind: 'form', id: ++this.serial, resolve };
    });
  }

  /** Answer a confirmation dialog; for a form only 'cancel' has meaning (use `submit` to submit). */
  answer(result: ConfirmResult): void {
    const pending = this.current;
    if (!pending) return;
    if (pending.kind === 'form') {
      if (result !== 'cancel') return;
      this.current = null;
      pending.resolve(null);
      return;
    }
    this.current = null;
    pending.resolve(result);
  }

  /** Submit the open form (ignored while a validation error is present). */
  submit(values: FormValues): void {
    const pending = this.current;
    if (!pending || pending.kind !== 'form') return;
    if (pending.validate?.(values)) return;
    this.current = null;
    pending.resolve(values);
  }

  private dismiss(): void {
    const pending = this.current;
    if (!pending) return;
    this.current = null;
    if (pending.kind === 'form') pending.resolve(null);
    else pending.resolve('cancel');
  }
}

export const dialogs = new DialogStore();
