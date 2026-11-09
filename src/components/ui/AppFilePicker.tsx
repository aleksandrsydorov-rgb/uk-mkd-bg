'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Upload, X } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { adminBtnSecondaryClass } from '@/components/admin/AdminUi';

export type AppFilePickerProps = {
  id?: string;
  name?: string;
  /** Visible field caption linked to the control. */
  label?: ReactNode;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  loading?: boolean;
  required?: boolean;
  capture?: InputHTMLAttributes<HTMLInputElement>['capture'];
  /** Formats / size hint shown under the control. */
  hint?: ReactNode;
  className?: string;
  /** Controlled selection. Pass `[]` / `null` to clear the displayed name. */
  files?: File[] | null;
  onChange?: (files: File[]) => void;
  /**
   * Clear the native input value after a successful pick so the same path
   * can be chosen again. Keep displayed name via `files` or internal state.
   */
  resetInputAfterChange?: boolean;
  /** Compact attach control (chat-style). */
  variant?: 'field' | 'icon';
  'aria-label'?: string;
};

function fileListFrom(files: FileList | null | undefined): File[] {
  return files ? Array.from(files) : [];
}

function displayName(files: File[]): string {
  if (files.length === 0) return '';
  if (files.length === 1) return files[0]?.name ?? '';
  return files.map((f) => f.name).join(', ');
}

/**
 * Localized file chooser. Native `input[type=file]` stays for the OS dialog only;
 * browser-locale button/status text is never shown.
 */
export function AppFilePicker({
  id,
  name,
  label,
  accept,
  multiple = false,
  disabled = false,
  loading = false,
  required = false,
  capture,
  hint,
  className = '',
  files,
  onChange,
  resetInputAfterChange = false,
  variant = 'field',
  'aria-label': ariaLabel,
}: AppFilePickerProps) {
  const { t } = useI18n();
  const autoId = useId();
  const inputId = id ?? autoId;
  const labelId = `${inputId}-label`;
  const statusId = `${inputId}-status`;
  const buttonId = `${inputId}-btn`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [internal, setInternal] = useState<File[]>([]);
  const controlled = files !== undefined;
  const selected = controlled ? (files ?? []) : internal;
  const hasFile = selected.length > 0;
  const busy = disabled || loading;
  const pickLabel = multiple ? t('common.filePickMany') : t('common.filePick');
  const statusText = hasFile ? displayName(selected) : t('common.fileNone');

  useEffect(() => {
    if (!controlled) return;
    if ((files ?? []).length === 0 && inputRef.current) {
      inputRef.current.value = '';
    }
  }, [controlled, files]);

  function openPicker() {
    if (busy) return;
    inputRef.current?.click();
  }

  function applyFiles(next: File[]) {
    if (!controlled) setInternal(next);
    onChange?.(next);
  }

  function onNativeChange(e: ChangeEvent<HTMLInputElement>) {
    const next = fileListFrom(e.target.files);
    // Cancel / empty change must keep the previous selection.
    if (next.length === 0) return;
    applyFiles(next);
    if (resetInputAfterChange && inputRef.current) {
      inputRef.current.value = '';
    }
  }

  function clearSelection() {
    if (inputRef.current) inputRef.current.value = '';
    applyFiles([]);
  }

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      name={name}
      type="file"
      accept={accept}
      multiple={multiple}
      disabled={busy}
      required={required && !hasFile}
      capture={capture}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={onNativeChange}
    />
  );

  if (variant === 'icon') {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`.trim()}>
        {input}
        <button
          type="button"
          disabled={busy}
          onClick={openPicker}
          aria-label={ariaLabel ?? (hasFile ? t('common.fileReplace') : pickLabel)}
          title={ariaLabel ?? (hasFile ? t('common.fileReplace') : pickLabel)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-secondary hover:bg-hover focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Upload className="h-4 w-4" aria-hidden />
        </button>
        {hasFile ? (
          <>
            <span className="min-w-0 max-w-[10rem] truncate text-xs text-secondary" title={statusText}>
              {statusText}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={clearSelection}
              className="shrink-0 text-xs text-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            >
              {t('common.fileClear')}
            </button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`grid min-w-0 gap-1.5 ${className}`.trim()}>
      {label ? (
        <label
          id={labelId}
          htmlFor={buttonId}
          className="text-sm text-secondary"
          onClick={(e) => {
            e.preventDefault();
            openPicker();
          }}
        >
          {label}
        </label>
      ) : null}
      {input}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          id={buttonId}
          type="button"
          disabled={busy}
          onClick={openPicker}
          aria-controls={inputId}
          aria-describedby={statusId}
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : ariaLabel ?? (hasFile ? t('common.fileReplace') : pickLabel)}
          className={`${adminBtnSecondaryClass} inline-flex min-h-10 shrink-0 items-center gap-2 focus:outline-none focus:ring-2 focus:ring-accent/30`}
        >
          <Upload className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            {loading
              ? t('common.loading')
              : hasFile
                ? t('common.fileReplace')
                : ariaLabel && !label
                  ? ariaLabel
                  : pickLabel}
          </span>
        </button>
        <span
          id={statusId}
          className="min-w-0 flex-1 truncate text-sm text-secondary"
          title={hasFile ? statusText : undefined}
          aria-live="polite"
        >
          {statusText}
        </span>
        {hasFile ? (
          <button
            type="button"
            disabled={busy}
            onClick={clearSelection}
            aria-label={t('common.fileClear')}
            className={`${adminBtnSecondaryClass} inline-flex h-10 w-10 shrink-0 items-center justify-center px-0 focus:outline-none focus:ring-2 focus:ring-accent/30`}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Human-readable size for picker hints (existing limits only). */
export function formatFileSizeMb(maxBytes: number): string {
  const mb = maxBytes / (1024 * 1024);
  const rounded = Number.isInteger(mb) ? String(mb) : mb.toFixed(1).replace(/\.0$/, '');
  return `${rounded} MB`;
}

type FormatAcceptHintT = (key: string, params?: Record<string, string | number>) => string;

/** Human-readable accept list for hints (no MIME codes like image/*). */
export function formatAcceptHint(
  accept: string | undefined,
  t?: FormatAcceptHintT,
): string {
  if (!accept?.trim()) return '';
  const label = (key: string, fallback: string) => (t ? t(key) : fallback);
  const labels: string[] = [];
  let hasImages = false;
  let hasPdf = false;
  let hasExcel = false;
  let hasWord = false;
  let hasText = false;
  for (const raw of accept.split(',')) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (p === 'image/*' || p.startsWith('image/')) {
      hasImages = true;
      continue;
    }
    if (p === 'application/pdf' || p === '.pdf') {
      hasPdf = true;
      continue;
    }
    if (
      p.includes('spreadsheet') ||
      p.includes('ms-excel') ||
      p === '.xlsx' ||
      p === '.xls' ||
      p === '.csv'
    ) {
      hasExcel = true;
      continue;
    }
    if (
      p.includes('word') ||
      p.includes('msword') ||
      p === '.doc' ||
      p === '.docx'
    ) {
      hasWord = true;
      continue;
    }
    if (p === 'text/plain' || p === '.txt') {
      hasText = true;
      continue;
    }
    if (p.startsWith('.')) labels.push(p);
  }
  const out: string[] = [];
  const imageExt = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.heic',
    '.bmp',
    '.svg',
    '.tif',
    '.tiff',
  ]);
  const coveredExt = new Set<string>();
  if (hasImages || labels.some((e) => imageExt.has(e))) {
    if (hasPdf || labels.includes('.pdf')) {
      out.push(label('common.fileFmtImagesPdf', 'Images and PDF'));
      coveredExt.add('.pdf');
    } else {
      out.push(label('common.fileFmtImages', 'Images'));
    }
    for (const e of imageExt) coveredExt.add(e);
  } else if (hasPdf || labels.includes('.pdf')) {
    out.push(label('common.fileFmtPdf', 'PDF (.pdf)'));
    coveredExt.add('.pdf');
  }
  if (hasExcel) {
    out.push(label('common.fileFmtExcel', 'Excel (.xlsx)'));
    coveredExt.add('.xlsx');
    coveredExt.add('.xls');
    coveredExt.add('.csv');
  }
  if (hasWord) {
    out.push(label('common.fileFmtWord', 'Word (.doc, .docx)'));
    coveredExt.add('.doc');
    coveredExt.add('.docx');
  }
  if (hasText) {
    out.push(label('common.fileFmtText', 'Text (.txt)'));
    coveredExt.add('.txt');
  }
  for (const ext of labels) {
    if (coveredExt.has(ext)) continue;
    out.push(ext);
  }
  return out.join(', ');
}
