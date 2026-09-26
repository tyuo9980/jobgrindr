import { useEffect, useRef, useState } from 'react';
import type { Application, ApplicationInput, WorkMode } from '../types';
import { currentStatusId } from '../types';
import type { StatusIndex } from '../statuses';
import { today } from '../api';

interface Props {
  /** The application to edit, or null to create a new one. */
  initial: Application | null;
  statuses: StatusIndex;
  /** Resolves true once saved; the form stays open on failure. */
  onSave: (input: ApplicationInput) => Promise<boolean>;
  onClose: () => void;
}

const SOURCES = ['LinkedIn', 'Indeed', 'Company site', 'Referral', 'Recruiter', 'Wellfound', 'Other'];

export default function ApplicationForm({ initial, statuses, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<ApplicationInput>(() => ({
    company: initial?.company ?? '',
    role: initial?.role ?? '',
    url: initial?.url ?? '',
    location: initial?.location ?? '',
    workMode: initial?.workMode ?? '',
    salary: initial?.salary ?? '',
    source: initial?.source ?? '',
    contact: initial?.contact ?? '',
    notes: initial?.notes ?? '',
    dateApplied: initial?.dateApplied ?? today(),
    statusId: initial ? currentStatusId(initial) : statuses.stages[0]?.id,
  }));
  const [saving, setSaving] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = <K extends keyof ApplicationInput>(key: K, value: ApplicationInput[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const saved = await onSave(draft);
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="form-title">
        <h2 id="form-title">{initial ? 'Edit application' : 'Add application'}</h2>

        <div className="form-grid">
          <label>
            Company *
            <input ref={firstField} required value={draft.company} onChange={(e) => set('company', e.target.value)} />
          </label>
          <label>
            Role *
            <input required value={draft.role} onChange={(e) => set('role', e.target.value)} />
          </label>
          <label className="span-2">
            Job posting URL
            <input type="url" placeholder="https://" value={draft.url} onChange={(e) => set('url', e.target.value)} />
          </label>
          <label>
            Date applied
            <input type="date" required value={draft.dateApplied} onChange={(e) => set('dateApplied', e.target.value)} />
          </label>
          <label>
            Status
            <select value={draft.statusId} onChange={(e) => set('statusId', Number(e.target.value))}>
              {statuses.list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Location
            <input value={draft.location} onChange={(e) => set('location', e.target.value)} />
          </label>
          <label>
            Work mode
            <select value={draft.workMode} onChange={(e) => set('workMode', e.target.value as WorkMode)}>
              <option value="">—</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
          </label>
          <label>
            Salary range
            <input placeholder="e.g. $120k–$140k" value={draft.salary} onChange={(e) => set('salary', e.target.value)} />
          </label>
          <label>
            Source
            <input list="sources" value={draft.source} onChange={(e) => set('source', e.target.value)} />
            <datalist id="sources">
              {SOURCES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="span-2">
            Contact
            <input placeholder="Recruiter or referrer name, email" value={draft.contact} onChange={(e) => set('contact', e.target.value)} />
          </label>
          <label className="span-2">
            Notes
            <textarea rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>

        {initial && initial.history.length > 1 && (
          <div className="history">
            <h3>Status history</h3>
            <ol>
              {initial.history.map((h, i) => (
                <li key={i}>
                  <span className="status-dot" style={{ background: statuses.color(h.statusId) }} />
                  {statuses.name(h.statusId)}
                  <span className="muted num">{h.date}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
