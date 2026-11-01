import { authenticated, boolean, date, entity, text, uuid } from '@microsoft/rayfin-core';

@entity()
@authenticated('*', { policy: (claims, item) => claims.sub.eq(item.user_id) })
export class GrantRecord {
  @uuid() id!: string;
  @text({ max: 200 }) user_id!: string;
  @text({ max: 200 }) sourceId!: string;
  @text({ max: 100 }) source!: string;
  @text({ max: 500 }) title!: string;
  @text({ max: 4000 }) summary!: string;
  @text({ max: 4000 }) eligibility!: string;
  @text({ max: 4000 }) howToApply!: string;
  @text({ max: 2000 }) url!: string;
  @text({ max: 100 }) status!: string;
  @text({ max: 100 }) closingDate!: string;
  @text({ max: 100 }) openingDate!: string;
  @text({ max: 100 }) amount!: string;
  @text({ max: 1000 }) jurisdictions!: string;
  @text({ max: 2000 }) categories!: string;
  @text({ max: 200 }) contentHash!: string;
  @boolean() active!: boolean;
  @text({ max: 500, optional: true }) programName?: string;
  @text({ max: 500, optional: true }) roundName?: string;
  @text({ max: 4000, optional: true }) summaryOverflow?: string;
  @text({ max: 4000, optional: true }) eligibilityOverflow?: string;
  @text({ max: 4000, optional: true }) howToApplyOverflow?: string;
  @text({ max: 4000, optional: true }) successNotification?: string;
  @text({ max: 1000, optional: true }) deliveredBy?: string;
  @text({ max: 1000, optional: true }) issuingAgency?: string;
  @text({ max: 1000, optional: true }) financialYearBudget?: string;
  @text({ max: 1000, optional: true }) assistanceType?: string;
  @text({ max: 2000, optional: true }) applicantTypes?: string;
  @text({ max: 2000, optional: true }) clientGroups?: string;
  @text({ max: 2000, optional: true }) fundingTypes?: string;
  @text({ max: 2000, optional: true }) businessActivities?: string;
  @text({ max: 2000, optional: true }) tagIds?: string;
  @text({ max: 2000, optional: true }) sourceIds?: string;
  @boolean({ optional: true }) isOpen?: boolean;
  @text({ max: 100, optional: true }) lastChangedAt?: string;
  @text({ max: 2000, optional: true }) sourceDatasetUrl?: string;
  @text({ max: 100, optional: true }) sourceUpdatedAt?: string;
  @text({ max: 2000, optional: true }) licenseUrl?: string;
  @text({ max: 1000, optional: true }) openingDateText?: string;
  @text({ max: 1000, optional: true }) closingDateText?: string;
  @text({ max: 2000, optional: true }) amountText?: string;
  @text({ max: 2000, optional: true }) additionalBudgetInformation?: string;
  @date({ optional: true }) importedAt?: Date;
}
