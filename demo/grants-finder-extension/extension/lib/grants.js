// Turns the agent's knowledge-base tool output + answer text into structured "grant cards".
// The agent cites sources with 【n:m†source】 markers whose numbering is not always reliable, so instead we
// match the grants the answer actually talks about (by title) against the documents the tool retrieved.

const STOP = new Set(['the', 'and', 'of', 'for', 'to', 'in', 'a', 'an', 'or', 'on', 'with', 'by', 'at', 'is', 'it', 'qld', 'queensland']);

const lite = (s) => String(s ?? '').toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'");
const tokens = (s) =>
  lite(s)
    .normalize('NFKD')
    .replace(/[^a-z0-9$ ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

export const grantDetailsPath = (grant) =>
  grant.source === 'Queensland Grants Finder' && /^\d+$/.test(grant.id) ? `/service-details/${grant.id}` : null;

/** Parses the JSON output of a `knowledge_base_retrieve` MCP call into grant records. */
export function parseRetrievedGrants(output) {
  let parsed;
  try {
    parsed = typeof output === 'string' ? JSON.parse(output) : output;
  } catch {
    return [];
  }
  const grants = [];
  for (const doc of Array.isArray(parsed?.documents) ? parsed.documents : []) {
    let g;
    try {
      g = JSON.parse(doc.content);
    } catch {
      continue; // synthesized answer / non-JSON chunk
    }
    if (!g?.id || typeof g.title !== 'string' || !g.title.trim()) continue;
    const status = typeof g.status === 'string' ? g.status : '';
    const closing = g.closingDate ? Date.parse(g.closingDate) : null;
    const isOpen = status.toLowerCase() === 'open' && (closing === null || closing >= Date.now());
    const url = typeof g.url === 'string' && /^https?:\/\//i.test(g.url) ? g.url : '';
    grants.push({
      id: String(g.id),
      detailsPath: grantDetailsPath(g),
      source: g.source ?? '',
      title: g.title,
      summary: g.summary ?? '',
      url,
      status: status.toLowerCase() === 'open' && !isOpen ? 'Closed' : status,
      isOpen,
      openingDate: g.openingDate ?? null,
      closingDate: g.closingDate ?? null,
      amount: typeof g.amount === 'number' ? g.amount : null,
      agency: g.issuingAgency ?? '',
      type: g.assistanceType ?? '',
      applicantTypes: g.applicantTypes ?? [],
    });
  }
  return grants;
}

/** Among several rounds with the same title, prefer the one linked in the answer, then open, then latest closing. */
function pickBest(group, text) {
  const t = lite(text);
  return [...group].sort(
    (a, b) =>
      Number(!!b.url && t.includes(lite(b.url))) - Number(!!a.url && t.includes(lite(a.url))) ||
      Number(b.isOpen) - Number(a.isOpen) ||
      String(b.closingDate ?? '').localeCompare(String(a.closingDate ?? '')),
  )[0];
}

/** Returns the retrieved grants the answer mentions, in the order they are mentioned. */
export function matchGrants(text, retrieved, limit = 6) {
  if (!text || !retrieved?.length) return [];
  const body = lite(text);
  const byTitle = new Map();
  for (const g of retrieved) {
    const key = tokens(g.title).join(' ');
    if (!byTitle.has(key)) byTitle.set(key, []);
    if (!byTitle.get(key).some((x) => x.id === g.id)) byTitle.get(key).push(g);
  }

  const hits = new Map(); // titleKey -> first position in the answer
  const note = (key, pos) => {
    if (pos >= 0 && (!hits.has(key) || pos < hits.get(key))) hits.set(key, pos);
  };

  // 1. Exact title mentions.
  for (const [key, group] of byTitle) {
    const title = lite(group[0].title);
    if (title.length >= 8) note(key, body.indexOf(title));
  }

  // 2. Bold phrases that closely match a title (the agent often shortens long program names).
  for (const m of text.matchAll(/\*\*([^*\n]{6,180})\*\*/g)) {
    const phrase = tokens(m[1]);
    if (phrase.length < 2) continue;
    let best = null;
    for (const [key, group] of byTitle) {
      const titleTokens = new Set(tokens(group[0].title));
      const inter = phrase.filter((t) => titleTokens.has(t)).length;
      const score = inter / phrase.length + inter / titleTokens.size;
      if (inter / phrase.length >= 0.8 && inter / titleTokens.size >= 0.5 && (!best || score > best.score)) {
        best = { key, score };
      }
    }
    if (best) note(best.key, m.index);
  }

  return [...hits.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([key]) => pickBest(byTitle.get(key), text))
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen)) // stable: open programs first, then answer order
    .slice(0, limit);
}

/** Extracts the search query the agent sent to the knowledge base. */
export function parseQuery(args) {
  try {
    const a = typeof args === 'string' ? JSON.parse(args) : args;
    return a?.query_variants?.[0] ?? a?.query ?? a?.intents?.[0]?.search ?? '';
  } catch {
    return '';
  }
}
