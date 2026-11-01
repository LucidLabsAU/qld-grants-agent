import { GrantRecord } from './GrantRecord.js';
import { GrantReview } from './GrantReview.js';
import { ChatTurn } from './ChatTurn.js';
import { GrantVersion } from './GrantVersion.js';

export type GrantsAppSchema = {
  GrantRecord: GrantRecord;
  GrantReview: GrantReview;
  ChatTurn: ChatTurn;
  GrantVersion: GrantVersion;
};

export const schema = [GrantRecord, GrantReview, ChatTurn, GrantVersion];
