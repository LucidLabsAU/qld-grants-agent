import { useEffect, useState } from 'react';
import { getGrantVersions, getReviews, type GrantRecord, type GrantVersion, type GrantReview } from '@/services/grants';

type RecordRow = GrantRecord | GrantVersion;
const fields = [
  ['status', 'Status'], ['amount', 'Amount (AUD)'], ['closingDate', 'Closes'], ['openingDate', 'Opens'],
  ['categories', 'Categories'], ['jurisdictions', 'Jurisdictions'], ['summary', 'Summary'],
  ['eligibility', 'Eligibility evidence'], ['howToApply', 'How to apply'], ['url', 'Official source'],
] as const satisfies readonly (readonly [keyof RecordRow, string])[];
const technicalFields = [
  ['source', 'Source'], ['sourceId', 'Source ID'], ['active', 'Active'], ['contentHash', 'Content hash'], ['id', 'Record ID'],
] as const satisfies readonly (readonly [keyof RecordRow, string])[];
const decisions: Record<GrantReview['decision'], string> = {
  researching: 'Researching', shortlisted: 'Shortlisted', ready: 'Ready to apply', dismissed: 'Dismissed',
};
const recordSorts = [['title', 'Grant title'], ['status', 'Status'], ['amount', 'Amount'], ['closingDate', 'Closing date'], ['archivedAt', 'Archive time']] as const;
const reviewSorts = [['title', 'Grant title'], ['decision', 'Decision'], ['createdAt', 'Review time']] as const;

export function ReviewerTable({ grants, onSelect, refreshKey }: {
  grants: GrantRecord[]; onSelect: (id: string) => void; refreshKey: number;
}) {
  const [versions, setVersions] = useState<GrantVersion[]>([]);
  const [reviews, setReviews] = useState<GrantReview[]>([]);
  const [mode, setMode] = useState('records');
  const [search, setSearch] = useState('');
  const [includeHistory, setIncludeHistory] = useState(true);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [decision, setDecision] = useState('');
  const [sort, setSort] = useState('title');
  const [descending, setDescending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([getGrantVersions(), getReviews()])
      .then(([history, decisions]) => { if (!cancelled) { setVersions(history); setReviews(decisions); } })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Reviewer history could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const allRows: RecordRow[] = [...grants, ...versions].filter((row) => row.jurisdictions.split('|').includes('Queensland'));
  const statuses = [...new Set(allRows.map((row) => row.status || 'Unknown'))].sort();
  const sources = [...new Set(allRows.map((row) => row.source))].sort();
  const matches = (row: RecordRow) => row.jurisdictions.split('|').includes('Queensland')
    && (!status || (row.status || 'Unknown') === status) && (!source || row.source === source)
    && [...fields, ...technicalFields].map(([field]) => String(row[field])).concat(
      row.title,
      row.openingDate ? new Date(row.openingDate).toLocaleDateString('en-AU') : '',
      row.closingDate ? new Date(row.closingDate).toLocaleDateString('en-AU') : '',
      'archivedAt' in row ? `Old version ${new Date(row.archivedAt).toLocaleString('en-AU')}` : 'Current',
    ).join(' ').toLowerCase().includes(search.toLowerCase());
  const rows: RecordRow[] = [...grants, ...(includeHistory ? versions : [])].filter(matches)
    .sort((a, b) => compare(recordSortValue(a, sort), recordSortValue(b, sort), descending));
  const visibleReviews = reviews.filter((review) => {
    const grant = grants.find((row) => row.id === review.grantId);
    return grant?.jurisdictions.split('|').includes('Queensland')
      && (!decision || review.decision === decision) && (!source || grant.source === source)
      && [grant.title, decisions[review.decision], review.notes, review.contentHash, review.id, review.grantId,
        new Date(review.createdAt).toLocaleString('en-AU'), new Date(review.createdAt).toISOString(),
        review.contentHash === grant.contentHash ? 'Current' : 'Old version — recheck evidence',
      ].join(' ').toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => compare(
    sort === 'title' ? grants.find((row) => row.id === a.grantId)?.title ?? null : sort === 'decision' ? decisions[a.decision] : new Date(a.createdAt).getTime(),
    sort === 'title' ? grants.find((row) => row.id === b.grantId)?.title ?? null : sort === 'decision' ? decisions[b.decision] : new Date(b.createdAt).getTime(),
    descending,
  ));

  function recordCell(row: RecordRow, key: keyof RecordRow) {
    const value = row[key];
    if (key === 'url' && row.url) return <a href={row.url} target="_blank" rel="noreferrer">{row.url}</a>;
    if (key === 'amount') return row.amount === '' ? 'Not specified' : Number(row.amount).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 });
    if (key === 'openingDate' || key === 'closingDate') return value ? new Date(String(value)).toLocaleDateString('en-AU') : 'Not specified';
    if (key === 'status') return row.status || 'Unknown';
    if (key === 'categories' || key === 'jurisdictions') return <EvidenceCell text={String(value || '—').split('|').join(', ')} />;
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return <EvidenceCell text={String(value || '—')} />;
  }

  return <section className="panel reviewer-table" aria-label="Reviewer tables">
    <div className="panel-heading"><h2>Reviewer table</h2><span>All stored fields and immutable evidence</span></div>
    <div className="table-toolbar">
      <label>Table<select className="form-select" value={mode} onChange={(event) => {
        setMode(event.target.value); setSort(event.target.value === 'records' ? 'title' : 'createdAt'); setDescending(event.target.value === 'reviews');
      }}>
        <option value="records">Grants &amp; versions</option><option value="reviews">Review history</option>
      </select></label>
      <label className="table-search">Search all fields<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title, evidence, source ID, content hash…" /></label>
      {mode === 'records' ? <label>Status<select className="form-select" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">All statuses</option>{statuses.map((value) => <option key={value}>{value}</option>)}
      </select></label> : <label>Decision<select className="form-select" value={decision} onChange={(event) => setDecision(event.target.value)}>
        <option value="">All decisions</option>{Object.entries(decisions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>}
      <label>Source<select className="form-select" value={source} onChange={(event) => setSource(event.target.value)}>
        <option value="">All sources</option>{sources.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label>Sort by<select className="form-select" value={sort} onChange={(event) => setSort(event.target.value)}>
        {(mode === 'records' ? recordSorts : reviewSorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Sort direction<select className="form-select" value={descending ? 'desc' : 'asc'} onChange={(event) => setDescending(event.target.value === 'desc')}>
        <option value="asc">Ascending</option><option value="desc">Descending</option>
      </select></label>
      {mode === 'records' && <label className="check"><input type="checkbox" checked={includeHistory} onChange={(event) => setIncludeHistory(event.target.checked)} />Include old versions</label>}
    </div>
    <p className="muted">All statuses, including closed grants. Old snapshots are preserved before imports change a record; versions overwritten before this feature are unavailable. Archive time is not the source publication date.</p>
    {loading && <p role="status">Loading version and review history…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {!loading && !error && <div className="table-scroll" tabIndex={0} role="region" aria-label={mode === 'records' ? 'Grant records and versions, scroll to see all columns' : 'Review history, scroll to see all columns'}>
      {mode === 'records' ? <table className="table table-striped">
        <caption>{rows.length} grant records and versions. Select a title to open the current grant in the workbench.</caption>
        <thead><tr><th scope="col">Grant</th>{fields.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}<th scope="col">Version</th><th scope="col">Archived at</th>{technicalFields.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={`${'grantId' in row ? 'version' : 'current'}-${row.id}`}>
          <th scope="row"><button className="table-link" onClick={() => onSelect('grantId' in row ? row.grantId : row.id)}>{row.title}</button></th>
          {fields.map(([key]) => <td key={key}>{recordCell(row, key)}</td>)}
          <td><span className="badge">{'grantId' in row ? 'Old version' : 'Current'}</span></td>
          <td>{'archivedAt' in row ? new Date(row.archivedAt).toLocaleString('en-AU') : '—'}</td>
          {technicalFields.map(([key]) => <td key={key}>{recordCell(row, key)}</td>)}
        </tr>)}</tbody>
      </table> : <table className="table table-striped">
        <caption>{visibleReviews.length} saved reviews, including decisions against old grant versions.</caption>
        <thead><tr>{['Grant', 'Decision', 'Evidence and next steps', 'Reviewed at', 'Version', 'Content hash', 'Review ID', 'Grant ID'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{visibleReviews.map((review) => {
          const grant = grants.find((row) => row.id === review.grantId)!;
          return <tr key={review.id}><th scope="row"><button className="table-link" onClick={() => onSelect(grant.id)}>{grant.title}</button></th>
            <td>{decisions[review.decision]}</td><td><EvidenceCell text={review.notes || '—'} /></td><td>{new Date(review.createdAt).toLocaleString('en-AU')}</td>
            <td>{review.contentHash === grant.contentHash ? 'Current' : 'Old version — recheck evidence'}</td><td>{review.contentHash}</td><td>{review.id}</td><td>{review.grantId}</td></tr>;
        })}</tbody>
      </table>}
      {!(mode === 'records' ? rows.length : visibleReviews.length) && <p className="empty">No matching records.</p>}
    </div>}
  </section>;
}

function recordSortValue(row: RecordRow, sort: string): string | number | null {
  switch (sort) {
    case 'amount': return row.amount === '' ? null : Number(row.amount);
    case 'closingDate': return row.closingDate ? Date.parse(row.closingDate) : null;
    case 'archivedAt': return 'archivedAt' in row ? new Date(row.archivedAt).getTime() : null;
    case 'status': return row.status || 'Unknown';
    default: return row.title;
  }
}

function compare(a: string | number | null, b: string | number | null, descending: boolean): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const result = typeof a === 'number' && typeof b === 'number'
    ? a - b : String(a).localeCompare(String(b), 'en-AU', { numeric: true, sensitivity: 'base' });
  return descending ? -result : result;
}

function EvidenceCell({ text }: { text: string }) {
  return text.length > 180
    ? <details className="table-evidence"><summary>{text.slice(0, 120)}… (read full text)</summary><p className="prose">{text}</p></details>
    : text;
}
