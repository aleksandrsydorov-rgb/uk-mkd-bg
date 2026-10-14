/** Phase IS-1 — Universal Module registration + lifecycle + setup contracts. */

export const MODULE_LIFECYCLE_STATES = [
  'DISABLED',
  'SETUP_REQUIRED',
  'SETUP_IN_PROGRESS',
  'READY',
  'ACTIVE',
  'SUSPENDED',
] as const;

export type ModuleLifecycleState = (typeof MODULE_LIFECYCLE_STATES)[number];

export type ModuleImportMethod = 'xlsx' | 'manual' | 'none';

export type ModuleSetupField = {
  key: string;
  required: boolean;
  valueType: 'string' | 'number' | 'date' | 'boolean' | 'json';
  labelKey?: string;
};

export type ModuleSetupStep = {
  id: string;
  titleKey: string;
  fields: ModuleSetupField[];
};

export type ModuleXlsxColumn = {
  key: string;
  required: boolean;
  example?: string;
  /** i18n key under admin.* or absolute message path */
  labelKey: string;
};

export type ModuleXlsxSchema = {
  schemaVersion: string;
  sheetName: string;
  columns: ModuleXlsxColumn[];
  instructionsKey?: string;
  maxRows?: number;
  maxBytes?: number;
};

export type ModuleSetupContract = {
  schemaVersion: string;
  steps: ModuleSetupStep[];
  importMethods: ModuleImportMethod[];
  xlsx?: ModuleXlsxSchema;
  completionCriteria: string[];
  idempotent: boolean;
};

export type ModuleRegistration = {
  /** Stable forever; aligns with module_catalog.module_key when known */
  moduleKey: string;
  version: string;
  nameKey: string;
  descriptionKey: string;
  dependencies: string[];
  requiredRoles: Array<'администрация' | 'owner' | 'staff'>;
  requiresInitialSetup: boolean;
  setup?: ModuleSetupContract;
  activationPrerequisites: string[];
  legalOrOperationalGates?: string[];
};

export type ImportRowOperation = 'create' | 'update' | 'skip' | 'error';

export type ImportPreviewRow = {
  rowNumber: number;
  operation: ImportRowOperation;
  data: Record<string, string>;
  errors: string[];
  matchKey?: string;
};

export type ImportPreviewResult = {
  schemaVersion: string;
  rows: ImportPreviewRow[];
  createCount: number;
  updateCount: number;
  skipCount: number;
  errorCount: number;
};

export type ModuleSetupAdapter = {
  registration: ModuleRegistration;
  /** Domain commit — never called by Core without admin confirm. */
  commitImport?(
    preview: ImportPreviewResult,
    ctx: { batchId: string; actorUid: string | null },
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  validateManual?(
    draft: Record<string, unknown>,
  ): { ok: true } | { ok: false; errors: string[] };
};
