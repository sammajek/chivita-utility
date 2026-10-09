import Image from "next/image";

/** The Chivita | Hollandia logo (200×51). Required on every page. */
export function Logo({ height = 36, className }: { height?: number; className?: string }) {
  const width = Math.round((200 / 51) * height);
  return (
    <Image src="/chivita-logo.png" alt="Chivita | Hollandia" width={width} height={height} priority className={className} />
  );
}
