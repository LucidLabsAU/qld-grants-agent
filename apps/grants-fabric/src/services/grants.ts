import type { GrantRecord } from '../../rayfin/data/GrantRecord';
import type { GrantReview } from '../../rayfin/data/GrantReview';
import type { ChatTurn } from '../../rayfin/data/ChatTurn';
import { getRayfinClient } from './rayfinClient';

export type GrantInput = Omit<GrantRecord, 'id' | 'user_id' | 'active'>;
export type { GrantRecord, GrantReview, ChatTurn };

function text(record: Record<string, unknown>, key: string, max: number, required = false): string {
  const value = record[key];
  if (value === null || value === undefined) {
    if (required) throw new Error(`Missing ${key}.`);
    return '';
  }
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`${key} must be ${required ? 'a non-empty' : 'a'} string of at most ${max} characters.`);
  }
  return value;
}

function list(record: Record<string, unknown>, key: string, max: number): string {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && !entry.includes('|'))) {
    throw new Error(`${key} must be an array of strings without pipe characters.`);
  }
  const joined = value.join('|');
  if (joined.length > max) throw new Error(`${key} exceeds ${max} characters.`);
  return joined;
}

export function parseGrantImport(input: unknown): GrantInput[] {
  if (!Array.isArray(input) || !input.length || input.length > 10_000) {
    throw new Error('Import a non-empty normalized grant JSON array (maximum 10,000 records).');
  }
  const seen = new Set<string>();
  return input.map((item: unknown, index) => {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Expected a grant object.');
      const record = item as Record<string, unknown>;
      const sourceId = text(record, 'id', 200, true);
      if (seen.has(sourceId)) throw new Error(`Duplicate grant ID ${sourceId}.`);
      seen.add(sourceId);
      const url = text(record, 'url', 2000);
      if (url && !['https:', 'http:'].includes(new URL(url).protocol)) throw new Error('Grant URL must use HTTPS or HTTP.');
      const openingDate = text(record, 'openingDate', 100);
      const closingDate = text(record, 'closingDate', 100);
      if ([openingDate, closingDate].some((date) => date && !Number.isFinite(Date.parse(date)))) throw new Error('Invalid grant date.');
      if (record.amount != null && (typeof record.amount !== 'number' || !Number.isFinite(record.amount) || record.amount < 0)) {
        throw new Error('Amount must be a non-negative number or null.');
      }
      return {
        sourceId, source: text(record, 'source', 100, true), title: text(record, 'title', 500, true),
        summary: text(record, 'summary', 4000), eligibility: text(record, 'eligibility', 4000),
        howToApply: text(record, 'howToApply', 4000), url, status: text(record, 'status', 100),
        openingDate, closingDate, amount: record.amount == null ? '' : String(record.amount),
        jurisdictions: list(record, 'jurisdictions', 1000), categories: list(record, 'categories', 2000),
        contentHash: text(record, 'contentHash', 200, true),
      };
    } catch (error) {
      throw new Error(`Record ${index + 1}: ${error instanceof Error ? error.message : 'Invalid grant.'}`);
    }
  });
}

export async function getGrants(): Promise<GrantRecord[]> {
  const rows: GrantRecord[] = [];
  let cursor: string | undefined;
  do {
    const query = getRayfinClient().data.GrantRecord.select([
      'id', 'user_id', 'sourceId', 'source', 'title', 'summary', 'eligibility', 'howToApply',
      'url', 'status', 'openingDate', 'closingDate', 'amount', 'jurisdictions', 'categories', 'contentHash', 'active',
    ]).orderBy({ id: 'asc' }).first(200);
    const page = await (cursor ? query.after(cursor) : query).executePaginated();
    rows.push(...page.items);
    if (page.hasNextPage && !page.endCursor) throw new Error('Grant pagination did not return a continuation cursor.');
    cursor = page.hasNextPage ? page.endCursor : undefined;
  } while (cursor);
  return rows;
}

export async function importGrants(input: unknown): Promise<number> {
  const records = parseGrantImport(input);
  const client = getRayfinClient();
  const session = client.auth.getSession();
  if (!session.isAuthenticated || !session.user) throw new Error('Sign in before importing grants.');
  const existing = new Map((await getGrants()).map((grant) => [grant.sourceId, grant]));
  let completed = 0;
  try {
    for (const record of records) {
      const previous = existing.get(record.sourceId);
      if (previous) {
        if (previous.contentHash !== record.contentHash || !previous.active) {
          await client.data.GrantRecord.update({ id: previous.id }, { ...record, active: true });
        }
      } else {
        await client.data.GrantRecord.create({ ...record, user_id: session.user.id, active: true });
      }
      completed++;
    }
  } catch (error) {
    throw new Error(`Import stopped after ${completed}/${records.length} records. Completed writes remain stored; retrying is safe. ${error instanceof Error ? error.message : 'Storage request failed.'}`);
  }
  return completed;
}

export async function getReviews(grantId: string): Promise<GrantReview[]> {
  const rows: GrantReview[] = [];
  let cursor: string | undefined;
  do {
    const query = getRayfinClient().data.GrantReview.select(['id', 'user_id', 'grantId', 'contentHash', 'decision', 'notes', 'createdAt'])
      .where({ grantId: { eq: grantId } }).orderBy({ createdAt: 'desc', id: 'asc' }).first(100);
    const page = await (cursor ? query.after(cursor) : query).executePaginated();
    rows.push(...page.items);
    if (page.hasNextPage && !page.endCursor) throw new Error('Review pagination did not return a continuation cursor.');
    cursor = page.hasNextPage ? page.endCursor : undefined;
  } while (cursor);
  return rows;
}

export async function saveReview(grant: GrantRecord, decision: GrantReview['decision'], notes: string): Promise<void> {
  const client = getRayfinClient();
  const session = client.auth.getSession();
  if (!session.isAuthenticated || !session.user) throw new Error('Sign in before saving a review.');
  if (!['shortlisted', 'researching', 'ready', 'dismissed'].includes(decision) || notes.length > 4000) throw new Error('Invalid review decision or notes.');
  await client.data.GrantReview.create({
    grantId: grant.id, user_id: session.user.id, contentHash: grant.contentHash,
    decision, notes, createdAt: new Date(),
  });
}

export async function getChat(): Promise<ChatTurn[]> {
  return getRayfinClient().data.ChatTurn.select(['id', 'user_id', 'question', 'answer', 'sourcesJson', 'createdAt'])
    .orderBy({ createdAt: 'desc', id: 'asc' }).first(20).execute();
}

export async function askGrants(question: string, selectedId: string, openOnly: boolean): Promise<void> {
  const client = getRayfinClient();
  const session = client.auth.getSession();
  if (!session.isAuthenticated || !session.user) throw new Error('Sign in before chatting.');
  const response = await client.functions.askGrants.invoke({ question, selectedId, openOnly }, { timeoutMs: 120_000 });
  const sourcesJson = JSON.stringify(response.sources);
  if (sourcesJson.length > 4000) throw new Error('The source citations exceed the storage limit. Ask about a single selected grant.');
  try {
    await client.data.ChatTurn.create({
      user_id: session.user.id, question, answer: response.answer,
      sourcesJson, createdAt: new Date(),
    });
  } catch (error) {
    throw new Error(`The answer could not be saved. ${error instanceof Error ? error.message : 'Storage request failed.'}`);
  }
}
