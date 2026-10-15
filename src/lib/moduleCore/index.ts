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
export {
  SUPPORT_FEE_MODULE_KEY,
  SUPPORT_FEE_SETUP_SCHEMA_VERSION,
  SUPPORT_FEE_OBLIGATION_TYPE,
  SUPPORT_FEE_OPENING_HEADERS,
  validateSupportFeeOpeningRow,
  classifySupportFeeOpeningRows,
  buildExistingSfScopeMap,
  supportFeeOpeningPayloadsFromPreview,
  buildSupportFeeIs4TemplateBuffer,
  downloadSupportFeeIs4Template,
  buildSupportFeeErrorReportXlsx,
  downloadSupportFeeErrorReport,
  openingAmountsConsistent,
  parseNonNegMoney,
  parseBillingYear,
  parseTransitionDate,
  scopeKey,
  type ExistingSfObligationRef,
  type SupportFeeOpeningRpcPayload,
} from '@/lib/moduleCore/adapters/supportFeeOpening';
export {
  supportFeeOpeningAdapter,
  downloadSupportFeeOpeningTemplate,
} from '@/lib/moduleCore/adapters/supportFeeOpeningAdapter';
export {
  SF_COMMIT_OUTCOMES,
  classifySfOpeningErrorMessage,
  commitSupportFeeOpeningBatch,
  reconcileSfCommitWithDb,
  retryCandidatesFromSfBatch,
  filterPreviewForSfRetry,
  mergeSfCommitBatches,
  sfCommitAuditPayload,
  d1OutstandingFromSfCommit,
  type SfCommitOutcome,
  type SfCommitRowResult,
  type SfCommitBatchResult,
} from '@/lib/moduleCore/adapters/supportFeeImportCommit';
export {
  INTERNET_MODULE_KEY,
  INTERNET_SETUP_SCHEMA_VERSION,
  INTERNET_TARIFF_KEY,
  INTERNET_OPENING_STATUSES,
  INTERNET_OPENING_HEADERS,
  validateInternetOpeningRow,
  classifyInternetOpeningRows,
  buildExistingInternetSubMap,
  internetOpeningPayloadsFromPreview,
  buildInternetIs5TemplateBuffer,
  downloadInternetIs5Template,
  buildInternetErrorReportXlsx,
  downloadInternetErrorReport,
  internetBillingDayFromDate,
  internetAddOneMonth,
  internetNextChargeOn,
  nextChargeAfterPaidThrough,
  internetOpeningBalanceEffect,
  parseOptionalIsoDate,
  type ExistingInternetSubRef,
  type InternetOpeningRpcPayload,
} from '@/lib/moduleCore/adapters/internetOpening';
export {
  internetOpeningAdapter,
  downloadInternetOpeningTemplate,
} from '@/lib/moduleCore/adapters/internetOpeningAdapter';
export {
  INTERNET_COMMIT_OUTCOMES,
  classifyInternetOpeningErrorMessage,
  commitInternetOpeningBatch,
  reconcileInternetCommitWithDb,
  retryCandidatesFromInternetBatch,
  filterPreviewForInternetRetry,
  mergeInternetCommitBatches,
  internetCommitAuditPayload,
  type InternetCommitOutcome,
  type InternetCommitRowResult,
  type InternetCommitBatchResult,
} from '@/lib/moduleCore/adapters/internetImportCommit';
