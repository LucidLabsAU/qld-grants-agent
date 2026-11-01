import { useState } from 'react';
import type { GrantRecord } from '@/services/grants';
import { hasField, fieldValue, qualityBySource, type QualityField } from '@/services/dataQuality';
import { catalogueFields } from '../../rayfin/functions/src/grantFields';

export function DataQuality({ grants, onSelect }: { grants: GrantRecord[]; onSelect: (id: string) => void }) {
  const [mode, setMode] = useState('sources');
  const [source, setSource] = useState('');
  const [scope, setScope] = useState('Queensland');
  const [search, setSearch] = useState('');
  const [missingField, setMissingField] = useState<QualityField | ''>('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const scoped = grants.filter((grant) => (includeInactive || grant.active)
    && (!scope || grant.jurisdictions.split('|').includes(scope)));
  const sources = [...new Set(scoped.map((grant) => grant.source))].sort();
  const records = scoped.filter((grant) => (!source || grant.source === source)
    && (!missingField || !hasField(grant, missingField))
    && catalogueFields.map(([key]) => String(fieldValue(grant, key) ?? '')).concat(grant.source, grant.sourceId)
      .join(' ').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.title.localeCompare(b.title) || a.sourceId.localeCompare(b.sourceId));
  const groups = qualityBySource(records);
  const fields: readonly (readonly [QualityField, string])[] = missingField ? catalogueFields.filter(([key]) => key === missingField) : catalogueFields;

  return <section className="panel reviewer-table data-quality" aria-label="Catalogue data quality">
    <div className="panel-heading"><h2>Data quality</h2><span>{records.length} programs · {groups.length} sources</span></div>
    <div className="table-toolbar">
      <label>Breakdown<select className="form-select" value={mode} onChange={(event) => setMode(event.target.value)}>
        <option value="sources">By source</option><option value="programs">By program / round</option>
      </select></label>
      <label className="table-search">Search programs<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Program, agency, evidence, source ID…" /></label>
      <label>Jurisdiction<select className="form-select" value={scope} onChange={(event) => { setScope(event.target.value); setSource(''); }}>
        <option value="Queensland">Queensland</option><option value="">All jurisdictions</option>
      </select></label>
      <label>Source<select className="form-select" value={source} onChange={(event) => setSource(event.target.value)}>
        <option value="">All sources</option>{sources.map((name) => <option key={name}>{name}</option>)}
      </select></label>
      <label>Find missing field<select className="form-select" value={missingField} onChange={(event) => setMissingField(event.target.value as QualityField | '')}>
        <option value="">All fields</option>{catalogueFields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <div className="form-check check"><input id="quality-inactive" className="form-check-input" type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />
        <label className="form-check-label" htmlFor="quality-inactive">Include inactive records</label></div>
    </div>
    <p className="muted">Field availability in current stored records, across all statuses; archived versions are excluded.
      Zero amounts and false flags are present. Missing dates, amounts or rounds may be legitimately unspecified or not applicable.
      These are source records, not globally deduplicated programs. Counts do not measure accuracy, freshness or eligibility.
      A cached open flag is not a current availability check.
      {mode === 'sources' && <> Counts shown by default. Click a field cell to switch between count and percentage.
        Green fills cover each cell in proportion to field availability.</>}</p>
    {missingField && <p className="warning">Showing only programs missing {catalogueFields.find(([key]) => key === missingField)?.[1]}. Counts use this filtered subset.</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Field completeness matrix, scroll to see all fields">
      <table className="table table-striped">
        <caption>{mode === 'sources' ? 'Field availability by source.' : 'Field availability by program / round.'}</caption>
        <thead><tr><th scope="col">{mode === 'sources' ? 'Source' : 'Program / round'}</th>
          <th scope="col">{mode === 'sources' ? 'Programs' : 'Source'}</th>
          {fields.map(([key, label]) => {
            const breakAt = label.length > 16 ? label.lastIndexOf(' ') : -1;
            return <th scope="col" key={key}>{breakAt > 0
              ? <>{label.slice(0, breakAt)}<br />{label.slice(breakAt)}</> : label}</th>;
          })}
        </tr></thead>
        <tbody>{mode === 'sources' ? groups.map((group) => <tr key={group.source}>
          <th scope="row"><button className="table-link" onClick={() => { setSource(group.source); setMode('programs'); }}>{group.source}</button></th>
          <td>{group.total}</td>{fields.map(([key, label]) => <QualityCell key={key}
            label={label} source={group.source} count={group.fields[key]} total={group.total} />)}
        </tr>) : records.map((grant) => <tr key={grant.id}>
          <th scope="row"><button className="table-link" onClick={() => onSelect(grant.id)}>{grant.title}</button><div className="muted">{grant.sourceId}</div></th>
          <td>{grant.source}</td>{fields.map(([key]) => <td key={key} title={String(fieldValue(grant, key) ?? '')}>
            {hasField(grant, key) ? 'Present' : 'Missing'}
          </td>)}
        </tr>)}</tbody>
      </table>
      {!records.length && <p className="empty">No programs match these data-quality filters.</p>}
    </div>
  </section>;
}

function QualityCell({ label, source, count, total }: { label: string; source: string; count: number; total: number }) {
  const [showPercent, setShowPercent] = useState(false);
  const percent = Math.round(count / total * 1000) / 10;
  return <td className="quality-field-cell" style={{ backgroundSize: `${percent}% 100%` }}>
    <span className="quality-cell-size" aria-hidden="true"><span>{count} / {total}</span><span>{percent}%</span></span>
    <button className="quality-cell-toggle" aria-pressed={showPercent}
      aria-label={`${label} completeness for ${source}: ${count} of ${total} records (${percent}%).`}
      title={showPercent ? 'Show count' : 'Show percentage'} onClick={() => setShowPercent(!showPercent)}>
      {showPercent ? `${percent}%` : `${count} / ${total}`}
    </button>
  </td>;
}
