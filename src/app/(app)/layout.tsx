import { AppHeader } from "@/components/AppHeader";
import { requireProfile } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return (
    <>
      <AppHeader profile={profile} />
      {!profile.active && (
        <div className="bg-amber-50 px-4 py-2 text-center text-sm text-warn">
          Your account is not active yet. Ask an admin to set your role.
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
