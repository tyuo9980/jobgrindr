import { useMemo, useState } from 'react';
import type { Application } from '../types';
import { currentStatusId, lastUpdated } from '../types';
import type { StatusIndex } from '../statuses';

type SortKey = 'company' | 'role' | 'status' | 'dateApplied' | 'lastUpdated' | 'location' | 'source';

interface Props {
  apps: Application[];
  statuses: StatusIndex;
  onEdit: (app: Application) => void;
  onDelete: (app: Application) => void;
  onStatusChange: (app: Application, statusId: number) => void;
}

const WORK_MODE_LABEL = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', '': '' };

function daysAgo(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((todayStart - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

function sortValue(app: Application, key: SortKey, statuses: StatusIndex): string | number {
  switch (key) {
    case 'status': {
      // Pipeline order, then the user's order among outcomes.
      const s = statuses.byId.get(currentStatusId(app));
      return s ? statuses.rank(s.id) * 10_000 + s.position : -1;
    }
    case 'lastUpdated':
      return lastUpdated(app);
    default:
      return app[key].toLowerCase();
  }
}

export default function ApplicationsTable({ apps, statuses, onEdit, onDelete, onStatusChange }: Props) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'dateApplied', dir: -1 });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps
      .filter((a) => {
        const s = currentStatusId(a);
        if (statusFilter === 'active' && !statuses.isActive(s)) return false;
        if (statusFilter !== 'all' && statusFilter !== 'active' && String(s) !== statusFilter) return false;
        if (!q) return true;
        return [a.company, a.role, a.location, a.source, a.notes, a.contact].some((f) =>
          f.toLowerCase().includes(q),
        );
      })
      .sort((a, b) => {
        const av = sortValue(a, sort.key, statuses);
        const bv = sortValue(b, sort.key, statuses);
        return av < bv ? -sort.dir : av > bv ? sort.dir : 0;
      });
  }, [apps, statuses, query, statusFilter, sort]);

  const header = (key: SortKey, label: string) => {
    const active = sort.key === key;
    return (
      <th aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          className="th-button"
          onClick={() => setSort({ key, dir: active ? (-sort.dir as 1 | -1) : 1 })}
        >
          {label}
          <span className="sort-arrow" aria-hidden>
            {active ? (sort.dir === 1 ? '▲' : '▼') : ''}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div>
      <div className="table-controls">
        <input
          type="search"
          placeholder="Search company, role, notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search applications"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          {statuses.list.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="row-count">
          {rows.length} of {apps.length}
        </span>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {header('company', 'Company')}
              {header('role', 'Role')}
              {header('status', 'Status')}
              {header('dateApplied', 'Applied')}
              {header('lastUpdated', 'Last update')}
              {header('location', 'Location')}
              <th>Salary</th>
              {header('source', 'Source')}
              <th>Contact</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-row">
                  {apps.length === 0 ? 'No applications yet.' : 'No applications match these filters.'}
                </td>
              </tr>
            )}
            {rows.map((a) => {
              const status = currentStatusId(a);
              return (
                <tr key={a.id}>
                  <td className="strong">{a.company}</td>
                  <td>
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer" title="Open job posting">
                        {a.role} <span aria-hidden>↗</span>
                      </a>
                    ) : (
                      a.role
                    )}
                    {a.notes && <div className="cell-note" title={a.notes}>{a.notes}</div>}
                  </td>
                  <td>
                    <label className="status-cell">
                      <span className="status-dot" style={{ background: statuses.color(status) }} />
                      <select
                        value={status}
                        onChange={(e) => onStatusChange(a, Number(e.target.value))}
                        aria-label={`Status for ${a.company}`}
                      >
                        {statuses.list.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </td>
                  <td className="num">{a.dateApplied}</td>
                  <td className="num muted" title={lastUpdated(a)}>
                    {daysAgo(lastUpdated(a))}
                  </td>
                  <td>
                    {a.location}
                    {a.workMode && a.location !== WORK_MODE_LABEL[a.workMode] && (
                      <span className="tag">{WORK_MODE_LABEL[a.workMode]}</span>
                    )}
                  </td>
                  <td>{a.salary}</td>
                  <td>{a.source}</td>
                  <td>{a.contact}</td>
                  <td className="actions">
                    <button className="link-button" onClick={() => onEdit(a)}>
                      Edit
                    </button>
                    <button className="link-button danger" onClick={() => onDelete(a)}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
