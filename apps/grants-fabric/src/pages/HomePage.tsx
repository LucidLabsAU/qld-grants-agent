import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/AuthContext';
import {
  askGrants, getChat, getGrants, getReviews, importGrants, saveReview,
  type ChatTurn, type GrantRecord, type GrantReview,
} from '@/services/grants';
import { isOpenNow, type ChatSource } from '../../rayfin/functions/src/grounding';

export function HomePage() {
  const { signOut, user } = useAuth();
  const [grants, setGrants] = useState<GrantRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [reviews, setReviews] = useState<GrantReview[]>([]);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [search, setSearch] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [decision, setDecision] = useState<GrantReview['decision']>('researching');
  const [notes, setNotes] = useState('');
  const [question, setQuestion] = useState('');
  const [scoped, setScoped] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const selected = grants.find((grant) => grant.id === selectedId);
  const visible = grants.filter((grant) => grant.active && grant.jurisdictions.split('|').includes('Queensland')
    && (!openOnly || isOpenNow(grant))
    && `${grant.title} ${grant.summary} ${grant.categories}`.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    let cancelled = false;
    Promise.all([getGrants(), getChat()])
      .then(([records, turns]) => { if (!cancelled) { setGrants(records); setChat(turns); } })
      .catch((err: unknown) => { if (!cancelled) setError(message(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReviews([]);
    setNotes('');
    setDecision('researching');
    if (selectedId) {
      getReviews(selectedId)
        .then((rows) => { if (!cancelled) setReviews(rows); })
        .catch((err: unknown) => { if (!cancelled) setError(message(err)); });
    }
    return () => { cancelled = true; };
  }, [selectedId]);

  async function run(action: string, operation: () => Promise<void>) {
    setBusy(action);
    setError('');
    setNotice('');
    try { await operation(); }
    catch (err) { setError(message(err)); }
    finally { setBusy(''); }
  }

  return (
    <div className="workbench">
      <header className="app-header">
        <div><span className="eyebrow">FABRIC / RAYFIN</span><h1>Grants Workbench</h1></div>
        <div className="header-actions"><span>{user?.email}</span><button onClick={() => void run('Signing out', signOut)}>Sign out</button></div>
      </header>
      <main>
        <div className="intro"><div><h2>Find funding. Keep the evidence.</h2><p>Your Queensland catalogue, review trail, and grounded research assistant in one workspace.</p></div>
          <label className="import-button">Import normalized grants
            <input type="file" accept=".json,application/json" disabled={!!busy} onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void run('Importing grants', async () => {
                if (file.size > 25_000_000) throw new Error('Import files must be under 25 MB.');
                const count = await importGrants(JSON.parse(await file.text()));
                setGrants(await getGrants());
                setNotice(`${count} grants imported into your private Fabric catalogue.`);
              });
            }} />
          </label>
        </div>
        {error && <div role="alert" className="error">{error}</div>}
        {notice && <div role="status" className="notice">{notice}</div>}
        {busy && <p role="status">{busy}…</p>}
        <div className="metrics"><div><strong>{grants.filter((grant) => grant.active).length}</strong><span>Stored grants</span></div>
          <div><strong>{grants.filter((grant) => grant.active && isOpenNow(grant)).length}</strong><span>Open now</span></div>
          <div><strong>Private</strong><span>Row-level user isolation</span></div>
          <div><strong>Versioned</strong><span>Append-only review history</span></div></div>
        <div className="columns">
          <section className="panel catalogue">
            <div className="panel-heading"><h2>Grant catalogue</h2><span>{visible.length} matching</span></div>
            <label>Search grants<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Innovation, community, export…" /></label>
            <label className="check"><input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />Open now only</label>
            <p className="muted">Queensland jurisdiction. Opening and closing dates checked now, not cached isOpen.</p>
            {loading ? <p>Loading Fabric data…</p> : visible.length === 0 ? <p className="empty">No matching grants. Import the JSON from the repository’s preview command, or adjust your filters.</p> : (
              <div className="grant-list">{visible.map((grant) => <button key={grant.id} disabled={!!busy} className={`grant-card ${selectedId === grant.id ? 'selected' : ''}`} onClick={() => setSelectedId(grant.id)}>
                <span className="badge">{isOpenNow(grant) ? 'Open now' : grant.status || 'Status unknown'}</span>
                <strong>{grant.title}</strong><span className="muted">{grant.summary.slice(0, 140)}</span>
                <span className="grant-meta">{grant.amount ? `AUD ${Number(grant.amount).toLocaleString()}` : 'Amount not specified'} · {grant.closingDate ? `Closes ${new Date(grant.closingDate).toLocaleDateString('en-AU')}` : 'No closing date'}</span>
              </button>)}</div>
            )}
          </section>
          <section className="panel review">
            <div className="panel-heading"><h2>Grant review</h2><span>Human decisions</span></div>
            {!selected ? <p className="empty">Select a grant to read its evidence and record a review.</p> : <>
              <h3>{selected.title}</h3>
              {selected.url && <a href={selected.url} target="_blank" rel="noreferrer">Official source ↗</a>}
              <p className="prose">{selected.summary || 'No summary supplied.'}</p>
              <details><summary>Eligibility evidence</summary><p className="prose">{selected.eligibility || 'Not supplied. Check the official source.'}</p></details>
              <details><summary>How to apply</summary><p className="prose">{selected.howToApply || 'Not supplied. Check the official source.'}</p></details>
              <form onSubmit={(event) => {
                event.preventDefault();
                void run('Saving review', async () => {
                  await saveReview(selected, decision, notes);
                  setReviews(await getReviews(selected.id));
                  setNotice('Review saved against this grant version.');
                });
              }}>
                <label>Review decision<select value={decision} onChange={(event) => setDecision(event.target.value as GrantReview['decision'])}>
                  <option value="researching">Researching</option><option value="shortlisted">Shortlisted</option><option value="ready">Ready to apply</option><option value="dismissed">Dismissed</option>
                </select></label>
                <label>Evidence and next steps<textarea value={notes} maxLength={4000} rows={4} onChange={(event) => setNotes(event.target.value)} placeholder="Record questions, evidence gaps, and next steps." /></label>
                <button className="primary" disabled={!!busy}>Save review</button>
              </form>
              <h3>Review history</h3>
              {!reviews.length && <p className="muted">No reviews yet. Decisions are research notes, not eligibility verdicts.</p>}
              {reviews.map((review) => <article className="history" key={review.id}>
                <strong>{review.decision}</strong><span className="muted"> · {new Date(review.createdAt).toLocaleString('en-AU')}</span>
                {review.contentHash !== selected.contentHash && <p className="warning">Grant content has changed since this review. Recheck the evidence.</p>}
                <p className="prose">{review.notes}</p>
              </article>)}
            </>}
          </section>
          <section className="panel chat">
            <div className="panel-heading"><h2>Research assistant</h2><span>Fabric-hosted function</span></div>
            <p className="muted">Retrieves your stored Queensland grants before answering. Keyword retrieval, not an exhaustive search. No eligibility verdicts.</p>
            <label className="check"><input type="checkbox" checked={scoped} onChange={(event) => setScoped(event.target.checked)} />Focus on selected grant</label>
            <div className="chat-history" aria-live="polite">
              {!chat.length && <p className="empty">Ask about funding, dates, or the evidence you need to check. The last 20 saved questions appear here; each answer retrieves fresh evidence.</p>}
              {[...chat].reverse().map((turn) => <article className="chat-turn" key={turn.id}>
                <h3>{turn.question}</h3><p className="prose">{turn.answer}</p>
                <Sources json={turn.sourcesJson} />
              </article>)}
            </div>
            <form onSubmit={(event) => {
              event.preventDefault();
              void run('Retrieving grants and asking the model', async () => {
                await askGrants(question.trim(), scoped && selected ? selected.id : '', openOnly);
                setChat(await getChat());
                setQuestion('');
              });
            }}>
              <label>Your question<textarea value={question} rows={3} maxLength={2000} onChange={(event) => setQuestion(event.target.value)} placeholder="What should I check before applying?" /></label>
              <button className="primary" disabled={!!busy || !question.trim()}>Ask with evidence</button>
            </form>
          </section>
        </div>
      </main>
      <footer>Prototype · Fabric-managed data, hosting and functions · Always confirm current details with the issuing agency.</footer>
    </div>
  );
}

function Sources({ json }: { json: string }) {
  let sources: ChatSource[];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || !parsed.every((source) => source && typeof source === 'object'
      && typeof source.id === 'string' && typeof source.title === 'string' && typeof source.url === 'string'
      && (!source.url || ['https:', 'http:'].includes(new URL(source.url).protocol)))) throw new Error('Invalid saved sources.');
    sources = parsed;
  } catch {
    return <p role="alert" className="error">Saved source citations could not be read.</p>;
  }
  return <div className="sources">{sources.map((source) => source.url
    ? <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
    : <span key={source.id}>{source.title} (no source URL supplied)</span>)}</div>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation failed. Please retry.';
}
