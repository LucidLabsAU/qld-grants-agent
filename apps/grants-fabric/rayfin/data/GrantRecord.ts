import { authenticated, boolean, entity, text, uuid } from '@microsoft/rayfin-core';

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
}
