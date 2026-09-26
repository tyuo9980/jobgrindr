import { useCallback, useMemo, useState } from 'react';
import type { Application } from '../types';
import { currentStatusId } from '../types';
import { useJobData } from '../api';
import type { User } from '../auth';
import { indexStatuses } from '../statuses';
import StatTiles from './StatTiles';
import StatusSankey from './StatusSankey';
import ApplicationsTable from './ApplicationsTable';
import ApplicationForm from './ApplicationForm';
import StatusManager from './StatusManager';

interface Props {
  user: User;
  /** Absent when the server runs without sign-in. */
  onSignOut?: () => void;
  onSessionEnded: () => void;
}

export default function Dashboard({ user, onSignOut, onSessionEnded }: Props) {
  const data = useJobData(onSessionEnded);
  const statuses = useMemo(() => indexStatuses(data.statuses), [data.statuses]);
  // undefined = closed, null = adding, Application = editing
  const [editing, setEditing] = useState<Application | null | undefined>(undefined);
  const [managingStatuses, setManagingStatuses] = useState(false);

  const closeForm = useCallback(() => setEditing(undefined), []);
  const closeStatuses = useCallback(() => setManagingStatuses(false), []);

  const changeStatus = (app: Application, statusId: number) => {
    if (statusId !== currentStatusId(app)) data.updateApplication(app.id, { statusId });
  };

  const deleteApp = (app: Application) => {
    if (window.confirm(`Delete ${app.role} at ${app.company}?`)) data.deleteApplication(app.id);
  };

  return (
    <div className="page">
      <header className="top-bar">
        <h1>jobgrindr</h1>
        <div className="top-actions">
          <button className="button" onClick={() => setManagingStatuses(true)} disabled={data.loading}>
            Statuses
          </button>
          <button className="button primary" onClick={() => setEditing(null)} disabled={data.loading}>
            + Add application
          </button>
          {onSignOut && (
            <button className="button" onClick={onSignOut} title={`Signed in as ${user.email}`}>
              Sign out
            </button>
          )}
        </div>
      </header>

      {data.error && (
        <div className="error-banner" role="alert">
          <span>{data.error}</span>
          <button className="link-button" onClick={data.dismissError}>
            Dismiss
          </button>
        </div>
      )}

      {data.loading ? (
        <div className="card muted">Loading…</div>
      ) : (
        <>
          <StatTiles apps={data.apps} statuses={statuses} />

          <section className="card">
            <div className="card-head">
              <h2>Application flow</h2>
              <p className="subtitle">How your applications move from applied to an outcome</p>
            </div>
            <StatusSankey apps={data.apps} statuses={statuses} />
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Applications</h2>
            </div>
            <ApplicationsTable
              apps={data.apps}
              statuses={statuses}
              onEdit={setEditing}
              onDelete={deleteApp}
              onStatusChange={changeStatus}
            />
          </section>
        </>
      )}

      {editing !== undefined && (
        <ApplicationForm
          initial={editing}
          statuses={statuses}
          onClose={closeForm}
          onSave={(input) =>
            editing ? data.updateApplication(editing.id, input) : data.createApplication(input)
          }
        />
      )}

      {managingStatuses && (
        <StatusManager
          statuses={statuses}
          onCreate={data.createStatus}
          onUpdate={data.updateStatus}
          onDelete={data.deleteStatus}
          onReorder={data.reorderStatuses}
          onClose={closeStatuses}
        />
      )}
    </div>
  );
}
