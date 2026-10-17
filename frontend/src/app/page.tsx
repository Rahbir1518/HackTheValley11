import Link from "next/link";

export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center">
      <Link href="/viewer" className="rounded bg-asphalt px-4 py-2 text-white">
        Open Ordis
      </Link>
    </main>
  );
}
