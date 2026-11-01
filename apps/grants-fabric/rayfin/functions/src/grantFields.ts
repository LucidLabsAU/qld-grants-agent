import type { GrantRecord } from '../../data/GrantRecord.js';

export function enableLosslessText(env: Record<string, string | undefined>): void {
  // Rayfin 1.36's legacy serializer otherwise turns date-looking @text values into Date objects.
  const flags = (env.RAYFIN_FEATURE_FLAGS ?? '').split(',').map((flag) => flag.trim()).filter(Boolean);
  if (!flags.some((flag) => flag.toLowerCase() === 'cli-minor-fixes')) flags.push('cli-minor-fixes');
  env.RAYFIN_FEATURE_FLAGS = flags.join(',');
}

export const grantFields = [
  'sourceId', 'source', 'title', 'summary', 'eligibility', 'howToApply',
  'url', 'status', 'openingDate', 'closingDate', 'amount', 'jurisdictions', 'categories', 'contentHash', 'active',
  'programName', 'roundName', 'summaryOverflow', 'eligibilityOverflow', 'howToApplyOverflow',
  'successNotification', 'deliveredBy', 'issuingAgency', 'financialYearBudget', 'assistanceType',
  'applicantTypes', 'clientGroups', 'fundingTypes', 'businessActivities', 'tagIds', 'sourceIds',
  'isOpen', 'lastChangedAt', 'sourceDatasetUrl', 'sourceUpdatedAt', 'licenseUrl',
  'openingDateText', 'closingDateText', 'amountText', 'additionalBudgetInformation', 'importedAt',
] as const satisfies readonly (keyof GrantRecord)[];

export const listFields = ['categories', 'jurisdictions', 'applicantTypes', 'clientGroups', 'fundingTypes', 'businessActivities', 'tagIds', 'sourceIds'] as const;
export const evidenceFields = ['summary', 'eligibility', 'howToApply'] as const;
export type EvidenceField = typeof evidenceFields[number];

export function evidenceText(grant: GrantRecord, field: EvidenceField): string {
  return (grant[field] || '') + (grant[`${field}Overflow`] || '');
}

export const catalogueFields = [
  ['title', 'Grant title'], ['programName', 'Program'], ['roundName', 'Round'],
  ['status', 'Status'], ['amount', 'Amount (AUD)'], ['amountText', 'Funding amount guidance'],
  ['closingDate', 'Closes'], ['closingDateText', 'Closing date guidance'],
  ['openingDate', 'Opens'], ['openingDateText', 'Opening date guidance'],
  ['financialYearBudget', 'Financial year budget'], ['additionalBudgetInformation', 'Budget guidance'],
  ['assistanceType', 'Assistance type'], ['applicantTypes', 'Applicant types'],
  ['categories', 'Categories'], ['jurisdictions', 'Jurisdictions'], ['clientGroups', 'Client groups'],
  ['fundingTypes', 'Funding types'], ['businessActivities', 'Business activities'],
  ['summary', 'Summary'], ['eligibility', 'Eligibility evidence'], ['howToApply', 'How to apply'],
  ['successNotification', 'Outcome notification'], ['deliveredBy', 'Delivered by'], ['issuingAgency', 'Issuing agency'],
  ['url', 'Official source'], ['sourceDatasetUrl', 'Source dataset'], ['sourceUpdatedAt', 'Dataset updated'],
  ['licenseUrl', 'Source licence'], ['sourceIds', 'Upstream IDs'], ['tagIds', 'Tag IDs'],
  ['isOpen', 'Cached open flag'], ['lastChangedAt', 'Source content changed'],
] as const satisfies readonly (readonly [keyof GrantRecord, string])[];
