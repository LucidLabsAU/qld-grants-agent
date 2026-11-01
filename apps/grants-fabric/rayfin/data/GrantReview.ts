import { authenticated, date, entity, set, text, uuid } from '@microsoft/rayfin-core';

@entity()
@authenticated(['create', 'read'], { policy: (claims, item) => claims.sub.eq(item.user_id) })
export class GrantReview {
  @uuid() id!: string;
  @text({ max: 200 }) user_id!: string;
  @uuid() grantId!: string;
  @text({ max: 200 }) contentHash!: string;
  @set('shortlisted', 'researching', 'ready', 'dismissed')
  decision!: 'shortlisted' | 'researching' | 'ready' | 'dismissed';
  @text({ max: 4000 }) notes!: string;
  @date() createdAt!: Date;
}
