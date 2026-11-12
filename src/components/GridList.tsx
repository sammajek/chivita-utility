import type { CSSProperties, ReactNode } from "react";

/**
 * A table whose rows open to show details or forms. Columns line up on tablets and computers
 * (`cols` is a CSS grid template, e.g. "2fr 1fr 8rem"); on phones each row stacks its cells.
 */
export function GridList({ cols, head, children, empty }: { cols: string; head: { label: string; num?: boolean }[]; children: ReactNode; empty?: ReactNode }) {
  const style = { "--cols": cols } as CSSProperties;
  const has = Array.isArray(children) ? children.flat().some(Boolean) : Boolean(children);
  return (
    <div className="grid-list" style={style}>
      <div className="grid-list-head" role="row">{head.map((h) => <span key={h.label} className={h.num ? "num" : ""}>{h.label}</span>)}</div>
      {has ? children : <p className="px-4 py-3 text-sm text-gray-500">{empty ?? "Nothing to show."}</p>}
    </div>
  );
}

export function GridRow({ cells, children, open }: { cells: { content: ReactNode; muted?: boolean; num?: boolean }[]; children?: ReactNode; open?: boolean }) {
  return (
    <details className="grid-list-row" open={open}>
      <summary>
        {cells.map((c, i) => <span key={i} className={`grid-list-cell ${c.muted ? "muted" : ""} ${c.num ? "num" : ""}`}>{c.content}</span>)}
      </summary>
      {children && <div className="grid-list-body">{children}</div>}
    </details>
  );
}
