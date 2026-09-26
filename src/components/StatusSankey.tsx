import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { sankey, sankeyJustify, sankeyLinkHorizontal } from 'd3-sankey';
import type { SankeyLink, SankeyNode } from 'd3-sankey';
import type { Application } from '../types';
import type { StatusIndex } from '../statuses';

/** A status id as a string, or the synthetic node for applications still in progress. */
type NodeId = string;

interface NodeDatum {
  id: NodeId;
  label: string;
  color: string;
}
interface LinkDatum {
  source: NodeId;
  target: NodeId;
  value: number;
}

type LaidNode = SankeyNode<NodeDatum, LinkDatum>;
type LaidLink = SankeyLink<NodeDatum, LinkDatum>;

const PENDING: NodeDatum = { id: 'pending', label: 'In progress', color: 'var(--status-pending)' };

/**
 * Turns each application's status history into a path through the pipeline.
 * Steps that move backwards are dropped so the graph stays acyclic, and
 * applications that are still active end in an "In progress" node so every
 * stage's inflow is accounted for.
 */
export function buildFlows(apps: Application[], statuses: StatusIndex) {
  const counts = new Map<string, number>();
  const used = new Set<NodeId>();

  for (const app of apps) {
    const path: number[] = [];
    let lastRank = -1;
    for (const { statusId } of app.history) {
      const rank = statuses.rank(statusId);
      if (rank > lastRank) {
        path.push(statusId);
        lastRank = rank;
      }
    }
    if (path.length === 0) continue;

    const ids: NodeId[] = path.map(String);
    if (statuses.isActive(path[path.length - 1])) ids.push(PENDING.id);

    ids.forEach((id) => used.add(id));
    for (let i = 1; i < ids.length; i++) {
      const key = `${ids[i - 1]}>${ids[i]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const nodes: NodeDatum[] = [...used].map((id) =>
    id === PENDING.id
      ? PENDING
      : { id, label: statuses.name(Number(id)), color: statuses.color(Number(id)) },
  );
  const links: LinkDatum[] = [...counts].map(([key, value]) => {
    const [source, target] = key.split('>');
    return { source, target, value };
  });
  return { nodes, links };
}

const HEIGHT = 380;
const MARGIN = { top: 8, right: 8, bottom: 8, left: 8 };

interface Tooltip {
  x: number;
  y: number;
  title: string;
  detail: string;
}

export default function StatusSankey({ apps, statuses }: { apps: Application[]; statuses: StatusIndex }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const graph = useMemo(() => {
    const { nodes, links } = buildFlows(apps, statuses);
    if (links.length === 0) return null;
    const layout = sankey<NodeDatum, LinkDatum>()
      .nodeId((d) => d.id)
      .nodeAlign(sankeyJustify)
      .nodeWidth(12)
      .nodePadding(18)
      .extent([
        [MARGIN.left, MARGIN.top],
        [Math.max(width, 320) - MARGIN.right, HEIGHT - MARGIN.bottom],
      ]);
    return layout({ nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) });
  }, [apps, statuses, width]);

  const total = apps.length;
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : '0%');

  const showTip = (e: React.PointerEvent, title: string, detail: string) => {
    const box = wrapRef.current!.getBoundingClientRect();
    setTooltip({ x: e.clientX - box.left, y: e.clientY - box.top, title, detail });
  };
  const hideTip = () => {
    setTooltip(null);
    setHovered(null);
  };

  if (!graph) {
    return (
      <div className="sankey-wrap" ref={wrapRef}>
        <div className="sankey-empty">
          Add applications and update their statuses to see how they move through each stage.
        </div>
      </div>
    );
  }

  const midX = width / 2;
  const linkKey = (l: LaidLink) =>
    `${(l.source as LaidNode).id}>${(l.target as LaidNode).id}`;
  const linkPath = sankeyLinkHorizontal<NodeDatum, LinkDatum>();

  return (
    <div className="sankey-wrap" ref={wrapRef}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label="Sankey diagram of application statuses. The applications table below lists the same data."
      >
        <g fill="none">
          {graph.links.map((l) => {
            const key = linkKey(l);
            const source = l.source as LaidNode;
            const target = l.target as LaidNode;
            const dim =
              hovered !== null && hovered !== key && hovered !== source.id && hovered !== target.id;
            return (
              <path
                key={key}
                d={linkPath(l) ?? undefined}
                stroke={target.color}
                strokeWidth={Math.max(l.width ?? 1, 1)}
                strokeOpacity={dim ? 0.12 : hovered === key ? 0.6 : 0.35}
                onPointerMove={(e) => {
                  setHovered(key);
                  showTip(e, `${source.label} → ${target.label}`, `${l.value} application${l.value === 1 ? '' : 's'}`);
                }}
                onPointerLeave={hideTip}
              />
            );
          })}
        </g>
        <g>
          {graph.nodes.map((n) => {
            const value = n.value ?? 0;
            const x0 = n.x0 ?? 0;
            const x1 = n.x1 ?? 0;
            const y0 = n.y0 ?? 0;
            const y1 = n.y1 ?? 0;
            const labelLeft = x0 > midX;
            return (
              <g
                key={n.id}
                onPointerMove={(e) => {
                  setHovered(n.id);
                  showTip(e, n.label, `${value} application${value === 1 ? '' : 's'} · ${pct(value)} of total`);
                }}
                onPointerLeave={hideTip}
              >
                {/* Wider invisible hit target than the 12px node. */}
                <rect x={x0 - 6} y={y0 - 4} width={x1 - x0 + 12} height={y1 - y0 + 8} fill="transparent" />
                <rect x={x0} y={y0} width={x1 - x0} height={Math.max(y1 - y0, 2)} rx={2} fill={n.color} />
                <text
                  x={labelLeft ? x0 - 8 : x1 + 8}
                  y={(y0 + y1) / 2}
                  dy="0.35em"
                  textAnchor={labelLeft ? 'end' : 'start'}
                  className="sankey-label"
                >
                  {n.label}
                  <tspan className="sankey-count" dx={6}>
                    {value}
                  </tspan>
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {tooltip && (
        <div
          className="tooltip"
          style={{
            left: Math.min(tooltip.x + 14, width - 200),
            top: tooltip.y + 14,
          }}
        >
          <div className="tooltip-title">{tooltip.title}</div>
          <div className="tooltip-detail">{tooltip.detail}</div>
        </div>
      )}
    </div>
  );
}
