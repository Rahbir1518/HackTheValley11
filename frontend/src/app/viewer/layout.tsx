import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { authDisabled, clerkEnabled } from "@/lib/auth-config";

export default async function ViewerLayout({ children }: { children: React.ReactNode }) {
  if (authDisabled) return children;
  if (!clerkEnabled) {
    return (
      <main className="grid min-h-screen place-items-center bg-paper p-6">
        <div className="max-w-lg rounded-lg border border-concrete bg-white p-6 text-sm leading-relaxed">
          <h1 className="mb-2 text-lg font-semibold">Sign-in isn&apos;t configured yet</h1>
          <p>
            Add <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and <code>CLERK_SECRET_KEY</code> from your{" "}
            <a className="underline" href="https://dashboard.clerk.com" target="_blank" rel="noreferrer">
              Clerk dashboard
            </a>{" "}
            to <code>frontend/.env.local</code> and restart <code>npm run dev</code>.
          </p>
          <p className="mt-2 text-steel">
            For local testing only you can set <code>ORDIS_DISABLE_AUTH=true</code> instead.
          </p>
          <Link href="/" className="mt-4 inline-block underline">
            Back to the home page
          </Link>
        </div>
      </main>
    );
  }
  await auth.protect(); // redirects signed-out visitors to the sign-in page
  return children;
}
