export function ComingSoon({ title, step }: { title: string; step: string }) {
  return (
    <div className="card">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-gray-600">This screen is being built in Phase 1, {step}.</p>
    </div>
  );
}
