"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { NAV_GROUPS, type NavItem } from "@/lib/roles";

interface Props {
  nav: NavItem[];
  name: string;
  roleLabel: string;
  unread: number;
  signOut: () => Promise<void>;
  banners: ReactNode;
  children: ReactNode;
}

const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

/** Grouped navigation that is always fully visible: a sidebar on large screens, a full menu sheet on phones. */
function NavGroups({ nav, path, onPick, compact }: { nav: NavItem[]; path: string; onPick?: () => void; compact?: boolean }) {
  const groups = [...NAV_GROUPS, "Admin"] as const;
  return (
    <div className={compact ? "grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3" : "space-y-4"}>
      {groups.map((g) => {
        const items = nav.filter((n) => n.group === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g}</p>
            <ul className="space-y-0.5">
              {items.map((n) => {
                const on = isActive(n.href, path);
                return (
                  <li key={n.href}>
                    <Link href={n.href} onClick={onPick} aria-current={on ? "page" : undefined}
                      className={`flex items-center rounded-lg px-3 text-sm font-medium transition ${compact ? "min-h-11" : "min-h-8"} ${
                        on ? "bg-brand-red/10 text-brand-red" : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"}`}>
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function UserBox({ name, roleLabel, unread, signOut }: Pick<Props, "name" | "roleLabel" | "unread" | "signOut">) {
  return (
    <div className="flex items-center gap-2">
      <Link href="/inbox" className="relative inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-100" aria-label={`Inbox, ${unread} unread`}>
        Inbox
        {unread > 0 && <span className="ml-1.5 rounded-full bg-brand-red px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{unread > 99 ? "99+" : unread}</span>}
      </Link>
      <div className="hidden text-right leading-tight sm:block">
        <div className="max-w-[14rem] truncate text-sm font-medium text-gray-900">{name}</div>
        <div className="text-xs text-gray-500">{roleLabel}</div>
      </div>
      <form action={signOut}>
        <button className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm text-gray-600 hover:bg-gray-100">Sign out</button>
      </form>
    </div>
  );
}

export function AppShell({ nav, name, roleLabel, unread, signOut, banners, children }: Props) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const current = nav.find((n) => isActive(n.href, path));

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar (large screens) */}
      <aside className="no-print hidden w-60 shrink-0 border-r border-gray-200 bg-white lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <Link href="/" className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
            <Logo height={30} />
          </Link>
          <p className="px-5 pt-3 text-xs font-semibold text-brand-blue">Utility Ops · Engineering</p>
                    <nav className="flex-1 overflow-y-auto px-2 py-3"><NavGroups nav={nav} path={path} /></nav>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Top bar */}
        <header className="no-print sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-2 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Link href="/" className="shrink-0 lg:hidden"><Logo height={26} /></Link>
              <span className="hidden truncate text-sm font-semibold text-gray-900 lg:inline">{current?.label ?? ""}</span>
            </div>
            <div className="flex items-center gap-1">
              <UserBox name={name} roleLabel={roleLabel} unread={unread} signOut={signOut} />
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-800 lg:hidden">
                <span aria-hidden className="text-base leading-none">{open ? "✕" : "☰"}</span> Menu
              </button>
            </div>
          </div>
          {open && (
            <div className="max-h-[calc(100vh-3.5rem)] overflow-y-auto border-t border-gray-100 bg-white px-3 pb-5 pt-4 shadow-lg lg:hidden">
              <NavGroups nav={nav} path={path} onPick={() => setOpen(false)} compact />
            </div>
          )}
        </header>
        {banners}
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
