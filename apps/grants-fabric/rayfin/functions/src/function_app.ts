import { AudienceType, UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import type { GrantsAppSchema } from '../../data/schema.js';
import type { GrantRecord } from '../../data/GrantRecord.js';
import { retrieveGrants, type ChatResult } from './grounding.js';
import { askCopilot } from './copilotChat.js';

const udf = new UserDataFunctions();

udf.func('askGrants', async (
  question: string,
  selectedId: string,
  openOnly: boolean,
  context: RayfinContext<GrantsAppSchema, AudienceType.AzureAI>,
): Promise<ChatResult> => {
  if (!question.trim() || question.length > 2000) throw new Error('Enter a question of 1–2000 characters.');
  if (typeof selectedId !== 'string' || typeof openOnly !== 'boolean') throw new Error('Invalid grant filters.');
  const data = context.getDataClient();
  const grants: GrantRecord[] = [];
  let cursor: string | undefined;
  do {
    const query = data.GrantRecord.select([
      'id', 'user_id', 'sourceId', 'source', 'title', 'summary', 'eligibility',
      'howToApply', 'url', 'status', 'openingDate', 'closingDate', 'amount',
      'jurisdictions', 'categories', 'contentHash', 'active',
    ]).where({ active: { eq: true } }).orderBy({ id: 'asc' }).first(200);
    const page = await (cursor ? query.after(cursor) : query).executePaginated();
    grants.push(...page.items);
    if (grants.length > 10_000) throw new Error('The catalogue exceeds this prototype’s 10,000-grant retrieval limit.');
    if (page.hasNextPage && !page.endCursor) throw new Error('Grant pagination did not return a continuation cursor.');
    cursor = page.hasNextPage ? page.endCursor : undefined;
  } while (cursor);

  const evidence = retrieveGrants(grants, question, selectedId, openOnly);
  if (!evidence.length) {
    return { answer: 'No matching Queensland grants were retrieved from your imported catalogue with these filters. Try a different keyword or import current grants. This is not an eligibility verdict.', sources: [] };
  }

  return askCopilot(
    question, evidence, context.Secrets.AI_ENDPOINT, context.Secrets.AI_DEPLOYMENT,
    async () => context.Tokens.AzureAI,
  );
}, []);
