import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { Identity, Ordi } from "@/components/brand";
import { clerkEnabled } from "@/lib/auth-config";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <header className="flex h-20 shrink-0 items-center justify-between border-b border-line px-6 md:px-12">
        <Identity size={32} tagline />
        <nav className="flex items-center gap-[30px] text-[13px]">
          <Link href="/#data" className="hidden text-muted hover:text-ink md:inline">
            Data
          </Link>
          <Link href="/#principles" className="hidden text-muted hover:text-ink md:inline">
            Principles
          </Link>
          <Link href="/ask" className="rounded-full border border-line px-4 py-2 text-ink hover:bg-soft">
            Enter Ordis ↗
          </Link>
        </nav>
      </header>
      <div className="grid flex-1 lg:grid-cols-[704px_1fr]">
        {/* Architectural welcome */}
        <section className="relative hidden overflow-hidden bg-side px-16 pt-[86px] lg:block">
          <p className="mono text-[11px] text-rust">YOUR CITY, IN PERSPECTIVE</p>
          <h1 className="mt-6 text-[64px] leading-[1.05] text-black">
            A clearer view
            <br />
            starts here.
          </h1>
          <p className="mt-6 max-w-[420px] text-[17px] leading-[1.6] text-muted">Understand the proposals shaping your neighbourhood. One address at a time.</p>
          <video
            src="/media/backgroundVid.mp4"
            muted
            autoPlay
            loop
            playsInline
            className="absolute bottom-12 left-0 w-full mix-blend-multiply opacity-80"
          />
          <p className="absolute bottom-9 left-16 flex items-center gap-2 text-[11px] text-muted">
            <Landmark className="size-4" strokeWidth={1.4} /> Built on City of Toronto open data.
          </p>
        </section>

        {/* Sign in panel */}
        <section className="flex flex-col justify-between px-6 pb-9 pt-16 md:px-[120px] lg:pt-[130px]">
          <div className="max-w-[496px] space-y-[30px]">
            <Ordi size={56} track />
            <div className="space-y-4">
              <h2 className="text-[40px] text-black">Sign in to Ordis.</h2>
              <p className="text-[15px] leading-[1.6] text-muted">New here? You&apos;re in the right place. Sign in or create an account to explore proposals near you.</p>
            </div>
            {clerkEnabled ? (
              <SignIn
                fallbackRedirectUrl="/ask"
                signUpFallbackRedirectUrl="/ask"
                appearance={{
                  variables: { colorPrimary: "#202322", borderRadius: "6px", fontFamily: "var(--font-inter)" },
                  elements: {
                    rootBox: { width: "100%" },
                    cardBox: { width: "100%", boxShadow: "none", border: "none" },
                    card: { width: "100%", boxShadow: "none", border: "none", padding: 0, background: "transparent" },
                    header: { display: "none" },
                    formFieldInput: { height: 54, borderRadius: 6, borderColor: "#dddfdb", fontSize: 15 },
                    formFieldLabel: { fontSize: 13, fontWeight: 400, color: "#000" },
                    formButtonPrimary: { height: 52, borderRadius: 9999, background: "#202322", fontSize: 14, fontWeight: 400, textTransform: "none", boxShadow: "none" },
                    socialButtonsBlockButton: { height: 48, borderRadius: 9999, borderColor: "#dddfdb" },
                    footer: { background: "transparent", borderTop: "none" },
                  },
                }}
              />
            ) : (
              <p className="rounded-md bg-side p-4 text-[13px] text-muted">Sign-in is not configured. Add your Clerk keys to frontend/.env.local (see the README).</p>
            )}
            <div className="h-px bg-line" />
            <p className="text-[11px] leading-[1.6] text-muted">By continuing, you agree to the Terms of use and acknowledge the Privacy policy.</p>
          </div>
          <div className="mt-10 flex max-w-[496px] justify-between text-[12px] text-muted">
            <Link href="/" className="hover:text-ink">
              ← Back to Ordis
            </Link>
            <a href="mailto:?subject=Ordis%20sign-in%20help" className="hover:text-ink">
              Need help?
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
