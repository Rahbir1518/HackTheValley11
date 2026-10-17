import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { authDisabled, clerkEnabled } from "@/lib/auth-config";

/** Server-side gate for signed-in pages (/ask, /viewer). */
export default async function AuthGate({ children }: { children: React.ReactNode }) {
  if (authDisabled) return children;
  if (!clerkEnabled) {
    return (
      <main className="grid min-h-screen place-items-center bg-side p-6">
        <div className="max-w-lg rounded-xl border border-line bg-white p-6 text-sm leading-relaxed">
          <h1 className="mb-2 text-lg">Sign-in isn&apos;t configured yet</h1>
          <p className="text-muted">
            Add <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and <code>CLERK_SECRET_KEY</code> to <code>frontend/.env.local</code> and restart{" "}
            <code>npm run dev</code>. For local testing only you can set <code>ORDIS_DISABLE_AUTH=true</code>.
          </p>
          <Link href="/" className="mt-4 inline-block underline">
            Back to Ordis
          </Link>
        </div>
      </main>
    );
  }
  await auth.protect(); // redirects signed-out visitors to the sign-in page
  return children;
}
