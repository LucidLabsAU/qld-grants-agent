import { authenticated, date, entity, text, uuid } from '@microsoft/rayfin-core';

@entity()
@authenticated(['create', 'read'], { policy: (claims, item) => claims.sub.eq(item.user_id) })
export class ChatTurn {
  @uuid() id!: string;
  @text({ max: 200 }) user_id!: string;
  @text({ max: 2000 }) question!: string;
  @text({ max: 4000 }) answer!: string;
  @text({ max: 4000 }) sourcesJson!: string;
  @date() createdAt!: Date;
}
