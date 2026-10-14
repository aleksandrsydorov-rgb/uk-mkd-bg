export * from '@/lib/moduleCore/types';
export * from '@/lib/moduleCore/lifecycle';
export * from '@/lib/moduleCore/registry';
export * from '@/lib/moduleCore/setup';
export * from '@/lib/moduleCore/xlsxEngine';
export {
  bootstrapModuleSetupAdapters,
  resetModuleSetupAdaptersForTests,
} from '@/lib/moduleCore/bootstrap';
export {
  PROPERTY_BOOK_MODULE_KEY,
  PROPERTY_BOOK_SETUP_SCHEMA_VERSION,
  DEFAULT_PROPERTY_BOOK_OPENING_POLICY,
  classifyPropertyBookOpeningRows,
  validatePropertyBookObjectProps,
  validatePropertyBookOwnerRow,
  previewFromPropertyBookDryRun,
  buildPropertyBookIs2TemplateBuffer,
  downloadPropertyBookIs2Template,
  buildPropertyBookErrorReportXlsx,
  downloadPropertyBookErrorReport,
} from '@/lib/moduleCore/adapters/propertyBookOpening';
export {
  propertyBookOpeningAdapter,
  downloadPropertyBookOpeningTemplate,
} from '@/lib/moduleCore/adapters/propertyBookOpeningAdapter';
export {
  WATER_MODULE_KEY,
  ELECTRICITY_MODULE_KEY,
  METERS_SETUP_SCHEMA_VERSION,
  OPENING_READING_ROW_COMMIT,
  DEFAULT_METER_OPENING_POLICY,
  WATER_METER_HEADERS,
  ELECTRICITY_METER_HEADERS,
  validateWaterMeterRow,
  validateElectricityMeterRow,
  validateOpeningReadingPreviewFields,
  parseInstalledAtDate,
  classifyWaterMeterOpeningRows,
  classifyElectricityMeterOpeningRows,
  buildApartmentLookup,
  activePropertyIdsFromMeters,
  serialSetFromMeters,
  waterAssignPayloadsFromPreview,
  electricityAssignPayloadsFromPreview,
  buildWaterMeterIs3TemplateBuffer,
  buildElectricityMeterIs3TemplateBuffer,
  downloadWaterMeterIs3Template,
  downloadElectricityMeterIs3Template,
  buildMeterErrorReportXlsx,
  downloadMeterErrorReport,
  isOpeningReadingRowCommitBlocked,
} from '@/lib/moduleCore/adapters/metersOpening';
export {
  waterOpeningAdapter,
  downloadWaterOpeningTemplate,
} from '@/lib/moduleCore/adapters/waterOpeningAdapter';
export {
  electricityOpeningAdapter,
  downloadElectricityOpeningTemplate,
} from '@/lib/moduleCore/adapters/electricityOpeningAdapter';
export {
  METER_COMMIT_OUTCOMES,
  classifyAssignErrorMessage,
  commitMeterInventoryBatch,
  reconcileMeterCommitWithDb,
  retryCandidatesFromBatch,
  filterPreviewForRetry,
  mergeMeterCommitBatches,
  meterCommitAuditPayload,
  type MeterCommitOutcome,
  type MeterCommitRowResult,
  type MeterCommitBatchResult,
} from '@/lib/moduleCore/adapters/metersImportCommit';
