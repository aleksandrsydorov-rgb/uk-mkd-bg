'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AdminModal } from '@/components/admin/AdminModal';
import {
  adminBtnDangerClass,
  adminBtnPrimaryClass,
  adminBtnSecondaryClass,
  adminFieldClass,
} from '@/components/admin/AdminUi';

export type AppConfirmTone = 'default' | 'danger';

export type AppConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: AppConfirmTone;
  /** Optional single-line reason / note collected before confirm. */
  promptLabel?: string;
  promptPlaceholder?: string;
  promptRequired?: boolean;
};

type Pending = AppConfirmOptions & {
  resolve: (value: { ok: true; value?: string } | { ok: false }) => void;
};

/**
 * In-app confirm/prompt host. Escape / overlay / Cancel → cancel.
 * Focus stays in the dialog and returns to the trigger on close.
 */
export function useAppConfirm(closeLabel = '×') {
  const [pending, setPending] = useState<Pending | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback((options: AppConfirmOptions) => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPromptValue('');
    return new Promise<{ ok: true; value?: string } | { ok: false }>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const ask = useCallback(
    async (options: AppConfirmOptions): Promise<boolean> => {
      const result = await confirm(options);
      return result.ok;
    },
    [confirm],
  );

  const askPrompt = useCallback(
    async (
      options: AppConfirmOptions,
    ): Promise<{ ok: true; value: string } | { ok: false }> => {
      const result = await confirm({
        ...options,
        promptLabel: options.promptLabel ?? options.title,
      });
      if (!result.ok) return { ok: false };
      return { ok: true, value: String(result.value ?? '').trim() };
    },
    [confirm],
  );

  function finish(ok: boolean) {
    if (!pending) return;
    const value = promptValue.trim();
    if (ok && pending.promptLabel && pending.promptRequired !== false && !value) {
      return;
    }
    const { resolve } = pending;
    setPending(null);
    setPromptValue('');
    if (ok) resolve({ ok: true, value: pending.promptLabel ? value : undefined });
    else resolve({ ok: false });
  }

  const dialog = (
    <AppConfirmDialogView
      open={pending != null}
      title={pending?.title ?? ''}
      description={pending?.description}
      confirmLabel={pending?.confirmLabel ?? ''}
      cancelLabel={pending?.cancelLabel ?? ''}
      tone={pending?.tone ?? 'default'}
      promptLabel={pending?.promptLabel}
      promptPlaceholder={pending?.promptPlaceholder}
      promptValue={promptValue}
      onPromptChange={setPromptValue}
      closeLabel={closeLabel}
      returnFocusRef={returnFocusRef}
      onCancel={() => finish(false)}
      onConfirm={() => finish(true)}
    />
  );

  return { confirm: ask, confirmDetailed: confirm, prompt: askPrompt, dialog };
}

function AppConfirmDialogView({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone,
  promptLabel,
  promptPlaceholder,
  promptValue,
  onPromptChange,
  closeLabel,
  returnFocusRef,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone: AppConfirmTone;
  promptLabel?: string;
  promptPlaceholder?: string;
  promptValue: string;
  onPromptChange: (v: string) => void;
  closeLabel: string;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const promptId = useId();
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (promptLabel) {
        const el = document.getElementById(promptId);
        if (el instanceof HTMLElement) el.focus();
        return;
      }
      confirmBtnRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, promptId, promptLabel]);

  return (
    <AdminModal
      open={open}
      title={title}
      onClose={onCancel}
      closeLabel={closeLabel}
      returnFocusRef={returnFocusRef}
      size="md"
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <button type="button" className={adminBtnSecondaryClass} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={tone === 'danger' ? adminBtnDangerClass : adminBtnPrimaryClass}
            onClick={onConfirm}
            disabled={Boolean(promptLabel) && !promptValue.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      {description ? (
        <p className="text-sm text-secondary whitespace-pre-wrap">{description}</p>
      ) : null}
      {promptLabel ? (
        <label className="mt-3 grid gap-1 text-sm text-foreground" htmlFor={promptId}>
          {promptLabel}
          <input
            id={promptId}
            className={adminFieldClass}
            value={promptValue}
            placeholder={promptPlaceholder}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm();
              }
            }}
          />
        </label>
      ) : null}
    </AdminModal>
  );
}
