import { useEffect, useState } from 'react';
import type { Status, StatusKind } from '../types';
import type { StatusIndex } from '../statuses';
import { SWATCHES } from '../statuses';
import type { StatusInput } from '../api';

interface Props {
  statuses: StatusIndex;
  onCreate: (input: StatusInput) => Promise<boolean>;
  onUpdate: (id: number, input: Partial<StatusInput>) => Promise<boolean>;
  onDelete: (id: number) => Promise<boolean>;
  onReorder: (ids: number[]) => Promise<boolean>;
  onClose: () => void;
}

function SwatchPicker({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Color">
      {SWATCHES.map((s) => (
        <button
          key={s.hex}
          type="button"
          role="radio"
          aria-checked={s.hex === value}
          aria-label={s.name}
          title={s.name}
          className="swatch"
          style={{ background: s.hex }}
          onClick={() => onPick(s.hex)}
        />
      ))}
    </div>
  );
}

function StatusRow({
  status,
  canMoveUp,
  canMoveDown,
  isLastStage,
  onMove,
  onUpdate,
  onDelete,
}: {
  status: Status;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isLastStage: boolean;
  onMove: (dir: -1 | 1) => void;
  onUpdate: Props['onUpdate'];
  onDelete: Props['onDelete'];
}) {
  const [name, setName] = useState(status.name);
  const [picking, setPicking] = useState(false);
  useEffect(() => setName(status.name), [status.name]);

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) setName(status.name);
    else if (trimmed !== status.name) onUpdate(status.id, { name: trimmed }).then((ok) => ok || setName(status.name));
  };

  const deleteBlocked = status.inUse > 0
    ? `Used by ${status.inUse} application${status.inUse === 1 ? '' : 's'}`
    : isLastStage
      ? 'At least one stage is required'
      : '';

  return (
    <li className="status-row">
      <div className="status-row-main">
        <div className="move-buttons">
          <button type="button" className="icon-button" disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label={`Move ${status.name} up`}>
            ▲
          </button>
          <button type="button" className="icon-button" disabled={!canMoveDown} onClick={() => onMove(1)} aria-label={`Move ${status.name} down`}>
            ▼
          </button>
        </div>
        <button
          type="button"
          className="swatch current"
          style={{ background: status.color }}
          aria-label={`Change color of ${status.name}`}
          aria-expanded={picking}
          onClick={() => setPicking((p) => !p)}
        />
        <input
          className="status-name"
          value={name}
          aria-label="Status name"
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <select
          value={status.kind}
          aria-label={`Kind of ${status.name}`}
          disabled={isLastStage}
          title={isLastStage ? 'At least one stage is required' : undefined}
          onChange={(e) => onUpdate(status.id, { kind: e.target.value as StatusKind })}
        >
          <option value="stage">Stage</option>
          <option value="outcome">Outcome</option>
        </select>
        <span className="muted usage">{status.inUse > 0 ? `${status.inUse} used` : ''}</span>
        <button
          type="button"
          className="link-button danger"
          disabled={Boolean(deleteBlocked)}
          title={deleteBlocked || `Delete ${status.name}`}
          onClick={() => onDelete(status.id)}
        >
          Delete
        </button>
      </div>
      {picking && (
        <SwatchPicker
          value={status.color}
          onPick={(hex) => {
            setPicking(false);
            onUpdate(status.id, { color: hex });
          }}
        />
      )}
    </li>
  );
}

export default function StatusManager({ statuses, onCreate, onUpdate, onDelete, onReorder, onClose }: Props) {
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<StatusKind>('stage');
  const [newColor, setNewColor] = useState(SWATCHES[4].hex);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stages = statuses.list.filter((s) => s.kind === 'stage');
  const outcomes = statuses.list.filter((s) => s.kind === 'outcome');

  // Swap with the neighbour of the same kind; positions are one list overall.
  const move = (group: Status[], index: number, dir: -1 | 1) => {
    const a = group[index];
    const b = group[index + dir];
    const ids = statuses.list.map((s) => s.id);
    const ia = ids.indexOf(a.id);
    const ib = ids.indexOf(b.id);
    [ids[ia], ids[ib]] = [ids[ib], ids[ia]];
    onReorder(ids);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    if (await onCreate({ name: newName.trim(), kind: newKind, color: newColor })) setNewName('');
  };

  const group = (title: string, hint: string, list: Status[]) => (
    <section className="status-group">
      <h3>{title}</h3>
      <p className="subtitle">{hint}</p>
      <ul>
        {list.map((s, i) => (
          <StatusRow
            key={s.id}
            status={s}
            canMoveUp={i > 0}
            canMoveDown={i < list.length - 1}
            isLastStage={s.kind === 'stage' && stages.length === 1}
            onMove={(dir) => move(list, i, dir)}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        ))}
        {list.length === 0 && <li className="muted empty-group">None yet</li>}
      </ul>
    </section>
  );

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-labelledby="statuses-title">
        <h2 id="statuses-title">Statuses</h2>

        {group(
          'Stages',
          'Steps an application moves through, in order. New applications start in the first one.',
          stages,
        )}
        {group('Outcomes', 'Where an application ends up.', outcomes)}

        <form className="add-status" onSubmit={add}>
          <h3>Add a status</h3>
          <div className="add-status-row">
            <input
              placeholder="e.g. Take-home"
              value={newName}
              maxLength={60}
              aria-label="New status name"
              onChange={(e) => setNewName(e.target.value)}
            />
            <select value={newKind} onChange={(e) => setNewKind(e.target.value as StatusKind)} aria-label="New status kind">
              <option value="stage">Stage</option>
              <option value="outcome">Outcome</option>
            </select>
            <button type="submit" className="button primary" disabled={!newName.trim()}>
              Add
            </button>
          </div>
          <SwatchPicker value={newColor} onPick={setNewColor} />
        </form>

        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
