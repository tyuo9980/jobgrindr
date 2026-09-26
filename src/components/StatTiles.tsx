import type { Application } from '../types';
import { currentStatusId } from '../types';
import type { StatusIndex } from '../statuses';

/** Whether the application ever reached a stage ranked at or after `rank`. */
const reachedRank = (app: Application, statuses: StatusIndex, rank: number) =>
  app.history.some((h) => {
    const s = statuses.byId.get(h.statusId);
    return s?.kind === 'stage' && statuses.rank(s.id) >= rank;
  });

export default function StatTiles({ apps, statuses }: { apps: Application[]; statuses: StatusIndex }) {
  const total = apps.length;
  const rate = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : '–');
  const { stages } = statuses;

  const active = apps.filter((a) => statuses.isActive(currentStatusId(a))).length;
  const outcomes = total - active;

  const tiles = [
    { label: 'Applications', value: String(total), note: `${active} active · ${outcomes} closed` },
  ];

  // With custom statuses the only structure we can rely on is stage order, so
  // report how far applications get: past the first stage, and to the last.
  if (stages.length > 1) {
    const second = stages[1];
    const past = apps.filter((a) => reachedRank(a, statuses, 1)).length;
    tiles.push({ label: `Reached ${second.name}`, value: rate(past), note: `${past} of ${total}` });
  }
  if (stages.length > 2) {
    const last = stages[stages.length - 1];
    const reached = apps.filter((a) => reachedRank(a, statuses, stages.length - 1)).length;
    tiles.push({ label: `Reached ${last.name}`, value: rate(reached), note: `${reached} of ${total}` });
  }

  return (
    <div className="tiles">
      {tiles.map((t) => (
        <div className="tile" key={t.label}>
          <div className="tile-label">{t.label}</div>
          <div className="tile-value">{t.value}</div>
          <div className="tile-note">{t.note}</div>
        </div>
      ))}
    </div>
  );
}
