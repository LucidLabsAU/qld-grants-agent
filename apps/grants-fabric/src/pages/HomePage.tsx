import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  askGrants, getChat, getGrants, getReviews, importGrants, saveReview,
  type ChatTurn, type GrantRecord, type GrantReview,
} from '@/services/grants';
import { isOpenNow, type ChatSource } from '../../rayfin/functions/src/grounding';
import { AppBrand, AppFooter } from '@/components/AppChrome';
import { ReviewerTable } from '@/components/ReviewerTable';
import { WelcomePage } from '@/pages/WelcomePage';
import { WhyAndHowPage } from '@/pages/WhyAndHowPage';
import { DataQuality } from '@/components/DataQuality';
import { catalogueFields, evidenceFields, evidenceText } from '../../rayfin/functions/src/grantFields';

const views = [
  { id: 'home', label: 'Home' }, { id: 'workbench', label: 'Browse and review' }, { id: 'table', label: 'Reviewer table' },
  { id: 'quality', label: 'Data quality' },
  { id: 'story', label: 'Why and How' },
] as const;
type WorkspaceView = typeof views[number]['id'];
const copyNotice = 'Answer copied to clipboard.';

export function HomePage() {
  const { signOut, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const storyOpen = location.pathname === '/why-and-how';
  const [workspaceRequested, setWorkspaceRequested] = useState(!storyOpen);
  const shouldLoadWorkspace = workspaceRequested || !storyOpen;
  const [grants, setGrants] = useState<GrantRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [reviews, setReviews] = useState<GrantReview[]>([]);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [search, setSearch] = useState('');
  const [catalogueSource, setCatalogueSource] = useState('business.gov.au');
  const [openOnly, setOpenOnly] = useState(true);
  const [decision, setDecision] = useState<GrantReview['decision']>('researching');
  const [notes, setNotes] = useState('');
  const [question, setQuestion] = useState('');
  const [scoped, setScoped] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Exclude<WorkspaceView, 'story'>>('home');
  const currentView = storyOpen ? 'story' : tab;
  const [refreshKey, setRefreshKey] = useState(0);
  const selected = grants.find((grant) => grant.id === selectedId);
  const catalogueSources = [...new Set(['business.gov.au', ...grants.map((grant) => grant.source)])].sort();
  const visible = grants.filter((grant) => grant.active && grant.jurisdictions.split('|').includes('Queensland')
    && (!catalogueSource || grant.source === catalogueSource)
    && (!openOnly || isOpenNow(grant))
    && catalogueFields.map(([key]) => evidenceFields.some((field) => field === key)
      ? evidenceText(grant, key as typeof evidenceFields[number]) : String(grant[key] ?? '')).join(' ').toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!shouldLoadWorkspace) return;
    let cancelled = false;
    Promise.all([getGrants(), getChat()])
      .then(([records, turns]) => { if (!cancelled) { setGrants(records); setChat(turns); } })
      .catch((err: unknown) => { if (!cancelled) setError(message(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [shouldLoadWorkspace]);

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

  useEffect(() => {
    if (notice !== copyNotice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function run(action: string, operation: () => Promise<void>) {
    setBusy(action);
    setError('');
    setNotice('');
    try { await operation(); }
    catch (err) { setError(message(err)); }
    finally { setBusy(''); }
  }

  function openView(view: WorkspaceView) {
    if (view === 'story') navigate('/why-and-how');
    else {
      setTab(view);
      setWorkspaceRequested(true);
      if (storyOpen) navigate('/');
    }
    document.getElementById(`${view}-tab`)?.focus();
  }

  function openGrant(id: string) {
    const grant = grants.find((record) => record.id === id);
    setSelectedId(id);
    if (grant) {
      setCatalogueSource(grant.source);
      if (!isOpenNow(grant)) setOpenOnly(false);
    }
    openView('workbench');
  }

  return (
    <div className={`workbench${storyOpen ? ' story-page' : ''}`}>
      <a className="skip-link" href="#workspace">Skip to main content</a>
      <div className="utility-bar">
        <div className="site-width utility-inner">
          <span>Queensland grants <span className="prototype-label">Independent prototype</span></span>
          <div className="header-actions"><span>{user?.email}</span><button onClick={() => void run('Signing out', signOut)}>Sign out</button></div>
        </div>
      </div>
      <header className="app-header">
        <div className="site-width masthead">
          <AppBrand heading={storyOpen ? 'div' : 'h1'} />
          <label className="import-button">Import grants
            <input type="file" accept=".json,application/json" disabled={!!busy} onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void run('Importing grants', async () => {
                if (file.size > 25_000_000) throw new Error('Import files must be under 25 MB.');
                const count = await importGrants(JSON.parse(await file.text()));
                setGrants(await getGrants());
                setRefreshKey((key) => key + 1);
                setNotice(`${count} grants imported into your private Fabric catalogue.`);
              });
            }} />
          </label>
        </div>
      </header>
      <div className="workspace-nav">
        <div className="site-width nav-inner">
          <div className="workspace-tabs" role="tablist" aria-label="Workspace view">
            {views.map((view, index) => <button key={view.id} id={`${view.id}-tab`} role="tab" aria-selected={currentView === view.id} aria-controls={`${view.id}-view`} tabIndex={currentView === view.id ? 0 : -1}
              onClick={() => openView(view.id)} onKeyDown={(event) => {
                if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length;
                openView(views[next].id);
              }}>
              {view.id === 'home' && <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 10 12 3l9 7v11h-6v-7H9v7H3Z" /></svg>}{view.label}
            </button>)}
          </div>
          {shouldLoadWorkspace && <div className="metrics" aria-label="Catalogue summary"><span><strong>{grants.filter((grant) => grant.active).length}</strong> grants</span>
            <span><strong>{grants.filter((grant) => grant.active && isOpenNow(grant)).length}</strong> open now</span></div>}
        </div>
      </div>
      <main className="workspace site-width" id="workspace" tabIndex={-1}>
        <nav className="workspace-breadcrumbs" aria-label="Breadcrumb"><ol>
          <li><a href="#home-view" onClick={(event) => { event.preventDefault(); openView('home'); }}>Queensland grants</a></li>
          <li aria-current="page">{currentView === 'home' ? 'About GrantFin' : views.find((view) => view.id === currentView)?.label}</li>
        </ol></nav>
        {error && <div role="alert" className="error">{error}</div>}
        {notice && <div role="status" className="notice">{notice}</div>}
        {busy && <p role="status">{busy}…</p>}
        <div id="story-view" role="tabpanel" aria-labelledby="story-tab" hidden={currentView !== 'story'}>
          {storyOpen && <WhyAndHowPage />}
        </div>
        <div id="home-view" role="tabpanel" aria-labelledby="home-tab" hidden={currentView !== 'home'} className="home-view">
          <WelcomePage onOpen={openView} />
        </div>
        <div id="table-view" role="tabpanel" aria-labelledby="table-tab" hidden={currentView !== 'table'} className="table-view">
          {currentView === 'table' && <ReviewerTable grants={grants} refreshKey={refreshKey} onSelect={openGrant} />}
        </div>
        <div id="quality-view" role="tabpanel" aria-labelledby="quality-tab" hidden={currentView !== 'quality'} className="table-view">
          {currentView === 'quality' && (loading ? <p role="status">Loading catalogue data quality…</p> : !error || grants.length
            ? <DataQuality grants={grants} onSelect={openGrant} /> : null)}
        </div>
        <div id="workbench-view" role="tabpanel" aria-labelledby="workbench-tab" hidden={currentView !== 'workbench'} className="columns">
          <section className="panel catalogue">
            <div className="panel-heading"><h2>Grant catalogue</h2><span>{visible.length} matching</span></div>
            <label>Catalogue source<select className="form-select" value={catalogueSource} onChange={(event) => setCatalogueSource(event.target.value)}>
              <option value="">All sources</option>{catalogueSources.map((source) => <option key={source} value={source}>{source}</option>)}
            </select></label>
            <p className="muted">This page defaults to business.gov.au, the original developer's ingestion source.
              Select All sources to include the expanded catalogue. These are manually imported snapshots, not live web results.</p>
            <label>Search grants<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Innovation, community, export…" /></label>
            <div className="form-check check"><input className="form-check-input" id="open-now-only" type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} /><label className="form-check-label" htmlFor="open-now-only">Open now only</label></div>
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
            <div className="review-content" tabIndex={0} role="region" aria-label="Grant evidence and review history">
            {!selected ? <p className="empty">Select a grant to read its evidence and record a review.</p> : <>
              <h3>{selected.title}</h3>
              {selected.url && <a href={selected.url} target="_blank" rel="noreferrer">Official source ↗</a>}
              <p className="prose">{evidenceText(selected, 'summary') || 'No summary supplied.'}</p>
              <details><summary>Eligibility evidence</summary><p className="prose">{evidenceText(selected, 'eligibility') || 'Not supplied. Check the official source.'}</p></details>
              <details><summary>How to apply</summary><p className="prose">{evidenceText(selected, 'howToApply') || 'Not supplied. Check the official source.'}</p></details>
              <details><summary>Program, funding and source details</summary><dl>
                {catalogueFields.filter(([key]) => !['title', 'summary', 'eligibility', 'howToApply'].includes(key)).map(([key, label]) => {
                  const value = selected[key];
                  return <div key={key}><dt>{label}</dt><dd className="prose">{typeof value === 'boolean' ? value ? 'Yes' : 'No'
                    : String(value || 'Not supplied').split('|').join(', ')}</dd></div>;
                })}
                <div><dt>Imported at</dt><dd>{selected.importedAt ? new Date(selected.importedAt).toLocaleString('en-AU') : 'Not recorded in the original import'}</dd></div>
              </dl></details>
              <h3>Review history</h3>
              {!reviews.length && <p className="muted">No reviews yet. Decisions are research notes, not eligibility verdicts.</p>}
              {reviews.map((review) => <article className="history" key={review.id}>
                <strong>{review.decision}</strong><span className="muted"> · {new Date(review.createdAt).toLocaleString('en-AU')}</span>
                {review.contentHash !== selected.contentHash && <p className="warning">Grant content has changed since this review. Recheck the evidence.</p>}
                <p className="prose">{review.notes}</p>
              </article>)}
            </>}
            </div>
            {selected && <form onSubmit={(event) => {
              event.preventDefault();
              void run('Saving review', async () => {
                await saveReview(selected, decision, notes);
                setReviews(await getReviews(selected.id));
                setRefreshKey((key) => key + 1);
                setNotice('Review saved against this grant version.');
              });
            }}>
              <label>Review decision<select className="form-select" value={decision} onChange={(event) => setDecision(event.target.value as GrantReview['decision'])}>
                <option value="researching">Researching</option><option value="shortlisted">Shortlisted</option><option value="ready">Ready to apply</option><option value="dismissed">Dismissed</option>
              </select></label>
              <label>Evidence and next steps<textarea value={notes} maxLength={4000} rows={3} onChange={(event) => setNotes(event.target.value)} placeholder="Record questions, evidence gaps, and next steps." /></label>
              <button className="primary" disabled={!!busy}>Save review</button>
            </form>}
          </section>
          <section className="panel chat">
            <div className="panel-heading"><h2>Research assistant</h2><span>Fabric-hosted function</span></div>
            <p className="muted">Retrieves your stored Queensland grants before answering. Keyword retrieval, not an exhaustive search. No eligibility verdicts.</p>
            <div className="form-check check"><input className="form-check-input" id="focus-selected-grant" type="checkbox" checked={scoped && !!selected} disabled={!selected} aria-describedby="chat-scope-info" onChange={(event) => setScoped(event.target.checked)} /><label className="form-check-label" htmlFor="focus-selected-grant">Focus on selected grant</label></div>
            <p id="chat-scope-info" className="muted scope-info">{!selected
              ? 'No grant selected. Choose one in the catalogue to focus your questions. Until then, the assistant searches your matching Queensland grants.'
              : scoped ? `Focused on: ${selected.title}` : 'Searching your matching Queensland grants, not just the selected grant.'}</p>
            <div className="chat-history" aria-live="polite">
              {!chat.length && <p className="empty">Ask about funding, dates, or the evidence you need to check. Your full conversation history is saved in Fabric SQL; each answer retrieves fresh evidence.</p>}
              {chat.map((turn) => <article className="chat-turn" key={turn.id}>
                <div className="chat-turn-tools"><time dateTime={new Date(turn.createdAt).toISOString()} className="muted">{new Date(turn.createdAt).toLocaleString('en-AU')}</time>
                  <button disabled={!!busy} onClick={() => void run('Copying answer', async () => {
                    if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Open the app in a secure browser context to copy answers.');
                    await navigator.clipboard.writeText(turn.answer);
                    setNotice(copyNotice);
                  })}>Copy answer</button></div>
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
              <label>Your question<textarea value={question} rows={2} maxLength={2000} onChange={(event) => setQuestion(event.target.value)} placeholder="What should I check before applying?" /></label>
              <button className="primary" disabled={!!busy || !question.trim()}>Ask with evidence</button>
            </form>
          </section>
        </div>
      </main>
      <AppFooter />
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
