import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { clerkEnabled } from "@/lib/auth-config";

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper p-6">
      <div className="flex flex-col items-center gap-6">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-[0.2em]">
          <span className="grid h-6 w-6 place-items-center rounded-sm bg-permit text-xs font-black">O</span>
          ORDIS
        </Link>
        {clerkEnabled ? (
          <SignIn fallbackRedirectUrl="/viewer" signUpFallbackRedirectUrl="/viewer" />
        ) : (
          <p className="text-sm text-steel">Sign-in is not configured. See the README.</p>
        )}
      </div>
    </main>
  );
}
