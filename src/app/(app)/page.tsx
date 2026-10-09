import { requireProfile } from "@/lib/auth";
import { navFor } from "@/lib/roles";
import { formatLagos, SHIFT_LABELS, shiftAt } from "@/lib/time";
import Link from "next/link";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const profile = await requireProfile();
  const { denied } = await searchParams;
  const now = new Date();
  const shift = shiftAt(now);
  const modules = navFor(profile.role).filter((n) => n.href !== "/");

  return (
    <div className="space-y-6">
      {denied && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">You don&apos;t have access to that page.</p>
      )}
      <section>
        <h1 className="text-2xl font-bold">Good to see you, {profile.full_name.split(" ")[0]}</h1>
        <p className="mt-1 text-gray-600">
          {formatLagos(now)} (Lagos) · {SHIFT_LABELS[shift.shift]}
        </p>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => (
          <Link key={m.href} href={m.href} className="card block hover:border-brand-blue">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">{m.label}</span>
              {!m.ready && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Coming soon</span>}
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
