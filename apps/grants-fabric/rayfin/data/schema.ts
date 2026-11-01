import { GrantRecord } from './GrantRecord.js';
import { GrantReview } from './GrantReview.js';
import { ChatTurn } from './ChatTurn.js';

export type GrantsAppSchema = {
  GrantRecord: GrantRecord;
  GrantReview: GrantReview;
  ChatTurn: ChatTurn;
};

export const schema = [GrantRecord, GrantReview, ChatTurn];
