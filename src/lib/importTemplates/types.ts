/** Shared import-template localization: key → labels → aliases → validation. */

export type ImportTemplateLocale = 'ru' | 'bg' | 'en';

export type ImportColumnFormat = 'text' | 'date' | 'money' | 'number';

export type ImportColumnDef = {
  /** Stable internal field key (never shown as a user header). */
  key: string;
  required: boolean;
  format?: ImportColumnFormat;
  /** Column width in Excel character units. */
  width?: number;
  /** Localized header shown in the downloaded template. */
  label: Record<ImportTemplateLocale, string>;
  /**
   * Extra header aliases accepted on import (legacy snake_case, older wording).
   * All `label` values are always accepted automatically.
   */
  aliases?: string[];
  /** Short instruction line per locale (column purpose / required / format). */
  instruction: Record<ImportTemplateLocale, string>;
  /** Example value shown only on the Instruction sheet (never on the data sheet). */
  example?: string;
  /**
   * When false, the column is still accepted on import (legacy files) but omitted
   * from downloaded templates and instruction tables. Default true.
   */
  includeInTemplate?: boolean;
};

export type ImportTemplateSpec = {
  /** Stable id for tests / logging. */
  id: string;
  /** Localized download base name without .xlsx. */
  fileBaseName: Record<ImportTemplateLocale, string>;
  /** Localized data-entry sheet title (max 31 chars). */
  dataSheetName: Record<ImportTemplateLocale, string>;
  /**
   * Legacy sheet names still accepted when finding the data sheet
   * (e.g. meters, opening_balances, budget).
   */
  legacySheetNames?: string[];
  columns: ImportColumnDef[];
  /** Title line on the Instruction sheet. */
  title: Record<ImportTemplateLocale, string>;
  /** Extra prose lines after the column table on Instruction. */
  notes?: Record<ImportTemplateLocale, string[]>;
  maxRows?: number;
};

export type ResolvedImportHeaders = {
  /** key → column index in the header row (-1 if missing). */
  indexByKey: Map<string, number>;
  missingRequired: ImportColumnDef[];
};
