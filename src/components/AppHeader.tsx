import Link from "next/link";
import { Logo } from "@/components/Logo";
import { signOut } from "@/app/login/actions";
import { navFor, ROLE_LABELS } from "@/lib/roles";
import type { Profile } from "@/lib/auth";

export function AppHeader({ profile }: { profile: Profile }) {
  const nav = navFor(profile.role);
  return (
    <header className="no-print sticky top-0 z-20 border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
        <Link href="/" className="flex items-center gap-3">
          <Logo height={32} />
          <span className="hidden text-sm font-semibold text-brand-blue sm:inline">Utility Ops</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight">
            <div className="text-sm font-medium">{profile.full_name}</div>
            <div className="text-xs text-gray-500">{ROLE_LABELS[profile.role]}</div>
          </div>
          <form action={signOut}>
            <button className="rounded-md px-2 py-2 text-sm text-gray-600 hover:bg-gray-100">Sign out</button>
          </form>
        </div>
      </div>
      <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-1">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="shrink-0 rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            {n.label}
            {!n.ready && <span className="ml-1 text-[10px] uppercase text-gray-400">soon</span>}
          </Link>
        ))}
      </nav>
    </header>
  );
}
