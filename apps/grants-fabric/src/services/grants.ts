import type { GrantRecord } from '../../rayfin/data/GrantRecord';
import type { GrantReview } from '../../rayfin/data/GrantReview';
import type { ChatTurn } from '../../rayfin/data/ChatTurn';
import type { GrantVersion } from '../../rayfin/data/GrantVersion';
import { getRayfinClient } from './rayfinClient';
import { grantFields } from '../../rayfin/functions/src/grantFields';

export type GrantInput = Omit<GrantRecord, 'id' | 'user_id' | 'active' | 'importedAt'>;
export type { GrantRecord, GrantReview, ChatTurn, GrantVersion };

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

function list(record: Record<string, unknown>, key: string, max: number, optional = false): string {
  const value = record[key];
  if (optional && value == null) return '';
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
      if (record.isOpen != null && typeof record.isOpen !== 'boolean') throw new Error('isOpen must be a boolean or null.');
      const longText = Object.fromEntries(['summary', 'eligibility', 'howToApply'].flatMap((key) => {
        const value = text(record, key, 8000);
        return [[key, value.slice(0, 4000)], [`${key}Overflow`, value.slice(4000)]];
      }));
      const dated = (key: string) => {
        const value = text(record, key, 100);
        if (value && !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${key}.`);
        return value;
      };
      const link = (key: string) => {
        const value = text(record, key, 2000);
        if (value && !['https:', 'http:'].includes(new URL(value).protocol)) throw new Error(`Invalid ${key} URL.`);
        return value;
      };
      return {
        sourceId, source: text(record, 'source', 100, true), title: text(record, 'title', 500, true),
        summary: longText.summary, summaryOverflow: longText.summaryOverflow,
        eligibility: longText.eligibility, eligibilityOverflow: longText.eligibilityOverflow,
        howToApply: longText.howToApply, howToApplyOverflow: longText.howToApplyOverflow,
        url, status: text(record, 'status', 100),
        openingDate, closingDate, amount: record.amount == null ? '' : String(record.amount),
        jurisdictions: list(record, 'jurisdictions', 1000), categories: list(record, 'categories', 2000),
        contentHash: text(record, 'contentHash', 200, true),
        programName: text(record, 'programName', 500), roundName: text(record, 'roundName', 500),
        successNotification: text(record, 'successNotification', 4000),
        deliveredBy: text(record, 'deliveredBy', 1000), issuingAgency: text(record, 'issuingAgency', 1000),
        financialYearBudget: text(record, 'financialYearBudget', 1000), assistanceType: text(record, 'assistanceType', 1000),
        applicantTypes: list(record, 'applicantTypes', 2000, true), clientGroups: list(record, 'clientGroups', 2000, true),
        fundingTypes: list(record, 'fundingTypes', 2000, true), businessActivities: list(record, 'businessActivities', 2000, true),
        tagIds: list(record, 'tagIds', 2000, true),
        sourceIds: record.sourceIds == null ? sourceId : list(record, 'sourceIds', 2000),
        isOpen: record.isOpen == null ? undefined : record.isOpen,
        lastChangedAt: dated('lastChangedAt'), sourceUpdatedAt: dated('sourceUpdatedAt'),
        sourceDatasetUrl: link('sourceDatasetUrl'), licenseUrl: link('licenseUrl'),
        openingDateText: text(record, 'openingDateText', 1000), closingDateText: text(record, 'closingDateText', 1000),
        amountText: text(record, 'amountText', 2000), additionalBudgetInformation: text(record, 'additionalBudgetInformation', 2000),
      };
    } catch (error) {
      throw new Error(`Record ${index + 1}: ${error instanceof Error ? error.message : 'Invalid grant.'}`);
    }
  });
}

export async function getGrants(client = getRayfinClient()): Promise<GrantRecord[]> {
  const rows: GrantRecord[] = [];
  let cursor: string | undefined;
  do {
    const query = client.data.GrantRecord.select(['id', 'user_id', ...grantFields]).orderBy({ id: 'asc' }).first(200);
    const page = await (cursor ? query.after(cursor) : query).executePaginated();
    rows.push(...page.items);
    if (page.hasNextPage && !page.endCursor) throw new Error('Grant pagination did not return a continuation cursor.');
    cursor = page.hasNextPage ? page.endCursor : undefined;
  } while (cursor);
  return rows;
}

export async function importGrants(input: unknown, client = getRayfinClient()): Promise<number> {
  const records = parseGrantImport(input);
  const session = client.auth.getSession();
  if (!session.isAuthenticated || !session.user) throw new Error('Sign in before importing grants.');
  const existing = new Map((await getGrants(client)).map((grant) => [grant.sourceId, grant]));
  let completed = 0;
  try {
    for (const record of records) {
      const previous = existing.get(record.sourceId);
      if (previous) {
        if (!previous.active || Object.entries(record).some(([key, value]) =>
          String(previous[key as keyof GrantInput] ?? '') !== String(value ?? ''))) {
          // Preserve evidence before overwriting; a failed archive must block the update.
          const archived = await client.data.GrantVersion.select(['id', ...grantFields])
            .where({ grantId: { eq: previous.id }, contentHash: { eq: previous.contentHash }, active: { eq: previous.active } })
            .first(100).execute();
          if (!archived.some((snapshot) => grantFields.every((key) => key === 'importedAt'
            ? (snapshot.importedAt ? new Date(snapshot.importedAt).getTime() : null) === (previous.importedAt ? new Date(previous.importedAt).getTime() : null)
            : String(snapshot[key] ?? '') === String(previous[key] ?? '')))) {
            const { id: grantId, ...snapshot } = previous;
            await client.data.GrantVersion.create({ ...snapshot, grantId, archivedAt: new Date() });
          }
          await client.data.GrantRecord.update({ id: previous.id }, { ...record, active: true, importedAt: new Date() });
        }
      } else {
        await client.data.GrantRecord.create({ ...record, user_id: session.user.id, active: true, importedAt: new Date() });
      }
      completed++;
    }
  } catch (error) {
    throw new Error(`Import stopped after ${completed}/${records.length} records. Completed writes remain stored; retrying is safe. ${error instanceof Error ? error.message : 'Storage request failed.'}`);
  }
  return completed;
}

export async function getGrantVersions(): Promise<GrantVersion[]> {
  const rows: GrantVersion[] = [];
  let cursor: string | undefined;
  do {
    const query = getRayfinClient().data.GrantVersion.select(['id', 'user_id', 'grantId', 'archivedAt', ...grantFields])
      .orderBy({ archivedAt: 'desc', id: 'asc' }).first(200);
    const page = await (cursor ? query.after(cursor) : query).executePaginated();
    rows.push(...page.items);
    if (page.hasNextPage && !page.endCursor) throw new Error('Version pagination did not return a continuation cursor.');
    cursor = page.hasNextPage ? page.endCursor : undefined;
  } while (cursor);
  return rows;
}

export async function getReviews(grantId?: string): Promise<GrantReview[]> {
  const rows: GrantReview[] = [];
  let cursor: string | undefined;
  do {
    const base = getRayfinClient().data.GrantReview.select(['id', 'user_id', 'grantId', 'contentHash', 'decision', 'notes', 'createdAt']);
    const query = (grantId ? base.where({ grantId: { eq: grantId } }) : base)
      .orderBy({ createdAt: 'desc', id: 'asc' }).first(100);
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
  const rows: ChatTurn[] = [];
  let cursor: string | undefined;
  do {
    const query = getRayfinClient().data.ChatTurn.select(['id', 'user_id', 'question', 'answer', 'sourcesJson', 'createdAt'])
      .orderBy({ createdAt: 'desc', id: 'asc' }).first(200);
    const page = await (cursor ? query.after(cursor) : query).executePaginated();
    rows.push(...page.items);
    if (page.hasNextPage && !page.endCursor) throw new Error('Chat pagination did not return a continuation cursor.');
    cursor = page.hasNextPage ? page.endCursor : undefined;
  } while (cursor);
  return rows;
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
