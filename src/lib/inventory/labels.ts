/**
 * User-facing labels for inventory enums. Codes stay in the data model;
 * unknown values must never be silently remapped to another known state.
 */

type TFn = (key: string, vars?: Record<string, string>) => string;

function presentMapped(code: string, map: Record<string, string>, t: TFn): string {
  const raw = String(code ?? '').trim();
  if (!raw) return '—';
  const key = map[raw] ?? map[raw.toUpperCase()] ?? map[raw.toLowerCase()];
  if (!key) return raw;
  const labeled = t(key);
  return labeled && labeled !== key ? labeled : raw;
}

const OWNERSHIP_KEYS: Record<string, string> = {
  CONDOMINIUM: 'admin.invOwnership_CONDOMINIUM',
  MANAGEMENT_COMPANY: 'admin.invOwnership_MANAGEMENT_COMPANY',
  THIRD_PARTY: 'admin.invOwnership_THIRD_PARTY',
};

const CONDITION_KEYS: Record<string, string> = {
  new: 'admin.inv6Condition_new',
  good: 'admin.inv6Condition_good',
  fair: 'admin.inv6Condition_fair',
  poor: 'admin.inv6Condition_poor',
  unserviceable: 'admin.inv6Condition_unserviceable',
};

const UNIT_KEYS: Record<string, string> = {
  pcs: 'admin.inv6Unit_pcs',
  l: 'admin.inv6Unit_l',
  ml: 'admin.inv6Unit_ml',
  kg: 'admin.inv6Unit_kg',
  g: 'admin.inv6Unit_g',
  m: 'admin.inv6Unit_m',
  pack: 'admin.inv6Unit_pack',
  box: 'admin.inv6Unit_box',
};

const ASSET_STATUS_KEYS: Record<string, string> = {
  draft: 'admin.invAssetStatus_draft',
  active: 'admin.invAssetStatus_active',
  assigned: 'admin.invAssetStatus_assigned',
  maintenance: 'admin.invAssetStatus_maintenance',
  written_off: 'admin.invAssetStatus_written_off',
  archived: 'admin.invAssetStatus_archived',
};

const MOVEMENT_KEYS: Record<string, string> = {
  OPENING: 'admin.invMove_OPENING',
  RECEIPT: 'admin.invMove_RECEIPT',
  ISSUE: 'admin.invMove_ISSUE',
  TRANSFER: 'admin.invMove_TRANSFER',
  ADJUSTMENT: 'admin.invMove_ADJUSTMENT',
  WRITE_OFF: 'admin.invMove_WRITE_OFF',
};

const LOCATION_KIND_KEYS: Record<string, string> = {
  common_area: 'admin.invLocKind_common_area',
  technical_room: 'admin.invLocKind_technical_room',
  office: 'admin.invLocKind_office',
  storage: 'admin.invLocKind_storage',
  apartment: 'admin.invLocKind_apartment',
  offsite: 'admin.invLocKind_offsite',
  other: 'admin.invLocKind_other',
};

const SESSION_STATUS_KEYS: Record<string, string> = {
  DRAFT: 'admin.invSessionStatus_DRAFT',
  IN_PROGRESS: 'admin.invSessionStatus_IN_PROGRESS',
  REVIEW: 'admin.invSessionStatus_REVIEW',
  APPROVED: 'admin.invSessionStatus_APPROVED',
  CLOSED: 'admin.invSessionStatus_CLOSED',
};

const TRACKING_KEYS: Record<string, string> = {
  INDIVIDUAL_ASSET: 'admin.invTracking_INDIVIDUAL_ASSET',
  QUANTITY_STOCK: 'admin.invTracking_QUANTITY_STOCK',
};

const MAINT_KEYS: Record<string, string> = {
  inspection: 'admin.invMaint_inspection',
  service: 'admin.invMaint_service',
  repair: 'admin.invMaint_repair',
  calibration: 'admin.invMaint_calibration',
  other: 'admin.invMaint_other',
};

const FINDING_STATUS_KEYS: Record<string, string> = {
  draft: 'admin.invFinding_draft',
  submitted: 'admin.invFinding_submitted',
  accepted: 'admin.invFinding_accepted',
  rejected: 'admin.invFinding_rejected',
};

const EVENT_KIND_KEYS: Record<string, string> = {
  created: 'admin.invEvent_created',
  activated: 'admin.invEvent_activated',
  updated: 'admin.invEvent_updated',
  transferred: 'admin.invEvent_transferred',
  assigned: 'admin.invEvent_assigned',
  maintenance: 'admin.invEvent_maintenance',
  written_off: 'admin.invEvent_written_off',
  archived: 'admin.invEvent_archived',
  document_added: 'admin.invEvent_document_added',
};

export const INVENTORY_LOCATION_KINDS = [
  'common_area',
  'technical_room',
  'office',
  'storage',
  'apartment',
  'offsite',
  'other',
] as const;

export const INVENTORY_UNIT_CODES = ['pcs', 'l', 'ml', 'kg', 'g', 'm', 'pack', 'box'] as const;

export const INVENTORY_MAINT_KINDS = [
  'inspection',
  'service',
  'repair',
  'calibration',
  'other',
] as const;

export function presentInventoryOwnership(code: string, t: TFn): string {
  return presentMapped(code, OWNERSHIP_KEYS, t);
}

export function presentInventoryCondition(code: string, t: TFn): string {
  return presentMapped(String(code).toLowerCase(), CONDITION_KEYS, t);
}

export function presentInventoryUnit(code: string, t: TFn): string {
  return presentMapped(String(code).toLowerCase(), UNIT_KEYS, t);
}

export function presentInventoryAssetStatus(code: string, t: TFn): string {
  return presentMapped(String(code).toLowerCase(), ASSET_STATUS_KEYS, t);
}

export function presentInventoryMovement(code: string, t: TFn): string {
  return presentMapped(String(code).toUpperCase(), MOVEMENT_KEYS, t);
}

export function presentInventoryLocationKind(code: string, t: TFn): string {
  return presentMapped(String(code).toLowerCase(), LOCATION_KIND_KEYS, t);
}

export function presentInventorySessionStatus(code: string, t: TFn): string {
  return presentMapped(String(code).toUpperCase(), SESSION_STATUS_KEYS, t);
}

export function presentInventoryTracking(code: string, t: TFn): string {
  return presentMapped(String(code).toUpperCase(), TRACKING_KEYS, t);
}

export function presentInventoryMaintenanceKind(code: string, t: TFn): string {
  return presentMapped(String(code).toLowerCase(), MAINT_KEYS, t);
}

export function presentInventoryFindingStatus(code: string, t: TFn): string {
  return presentMapped(String(code).toLowerCase(), FINDING_STATUS_KEYS, t);
}

export function presentInventoryEventKind(code: string, t: TFn): string {
  return presentMapped(String(code).toLowerCase(), EVENT_KIND_KEYS, t);
}

/** Action label for the selected stock movement type. */
export function presentInventoryMoveAction(code: string, t: TFn): string {
  const raw = String(code ?? '').trim().toUpperCase();
  const key = `admin.invMoveAction_${raw}`;
  const labeled = t(key);
  if (labeled && labeled !== key) return labeled;
  return presentInventoryMovement(raw, t);
}
