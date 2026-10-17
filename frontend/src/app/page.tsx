import Link from "next/link";
import { Box, Equal, Layers, ScanText } from "lucide-react";
import { Identity, Ordi } from "@/components/brand";
import ScrollStory from "@/components/landing/ScrollStory";

const DATASETS: [string, string][] = [
  ["Development Applications", "https://open.toronto.ca/dataset/development-applications/"],
  ["Property Boundaries", "https://open.toronto.ca/dataset/property-boundaries/"],
  ["3D Massing", "https://open.toronto.ca/dataset/3d-massing/"],
  ["Neighbourhood Profiles", "https://open.toronto.ca/dataset/neighbourhood-profiles/"],
  ["Street Trees", "https://open.toronto.ca/dataset/street-tree-data/"],
];

const PRINCIPLES = [
  { Icon: ScanText, title: "Stated vs estimated", body: "Every estimate comes with a visible rule. You can always tell what the application says and what the model infers." },
  { Icon: Box, title: "No fabricated buildings", body: "When an application is unclear, we say so. We don't fill gaps with buildings that were never proposed." },
  { Icon: Layers, title: "A model, not a promise", body: "These are massing approximations, not architectural renderings or a guarantee of what will be built." },
  { Icon: Equal, title: "Neutral", body: "No advocacy for or against development. Just the information you need to form your own view." },
];

export default function Home() {
  return (
    <main className="bg-white text-black">
      {/* Public navigation */}
      <header className="fixed inset-x-0 top-0 z-50 flex h-20 items-center justify-between border-b border-line/70 bg-white/85 px-6 backdrop-blur-md md:px-12">
        <Identity size={32} tagline />
        <nav className="flex items-center gap-[30px] text-[13px]">
          <a href="#data" className="hidden text-muted hover:text-ink md:inline">
            Data
          </a>
          <a href="#principles" className="hidden text-muted hover:text-ink md:inline">
            Principles
          </a>
          <Link href="/sign-in" className="hidden text-muted hover:text-ink md:inline">
            Sign in
          </Link>
          <Link href="/ask" className="rounded-full border border-line px-4 py-2 text-ink hover:bg-soft">
            Enter Ordis ↗
          </Link>
        </nav>
      </header>

      <ScrollStory />

      {/* Public trust and participation */}
      <section className="space-y-24 px-6 pb-16 pt-[90px] md:px-20">
        <div id="data" className="grid scroll-mt-28 gap-[88px] lg:grid-cols-[620px_1fr]">
          <div className="space-y-8">
            <p className="mono text-[11px] text-rust">OPEN DATA. OPEN CONTEXT.</p>
            <h2 className="text-[52px] leading-[1.1] text-black">
              Built on the City&apos;s
              <br />
              own records.
            </h2>
            <p className="max-w-[490px] text-[17px] leading-[1.6] text-muted">Not a new version of the facts. A more useful way to explore the public information that already exists.</p>
            <div className="grid grid-cols-3 gap-8 pt-6">
              {[
                ["26k+", "Applications"],
                ["428k", "3D buildings"],
                ["688k", "Street trees"],
              ].map(([n, l]) => (
                <div key={l} className="space-y-2.5">
                  <p className="text-[42px] font-medium text-black">{n}</p>
                  <p className="text-[12px] text-muted">{l}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[24px] bg-side p-7">
            <p className="mono text-[10px] text-muted">CITY OF TORONTO / OPEN DATA</p>
            {DATASETS.map(([name, href]) => (
              <a key={name} href={href} target="_blank" rel="noreferrer" className="group flex h-[63px] items-center justify-between border-b border-line">
                <span className="text-[15px] text-black">{name}</span>
                <span className="text-[18px] text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">↗</span>
              </a>
            ))}
            <a href="https://open.toronto.ca/" target="_blank" rel="noreferrer" className="mt-4 block text-[11px] text-muted hover:text-ink">
              Explore the sources at open.toronto.ca ↗
            </a>
          </div>
        </div>

        <div id="principles" className="scroll-mt-28 space-y-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h2 className="text-[52px] text-black">Honest by design.</h2>
            <p className="w-[365px] text-[16px] leading-[1.5] text-muted">
              Clear about what it knows.
              <br />
              Just as clear about what it doesn&apos;t.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {PRINCIPLES.map(({ Icon, title, body }) => (
              <div key={title} className="space-y-[26px] rounded-[24px] bg-side p-[26px]">
                <Icon className="size-[26px]" strokeWidth={1.3} />
                <div className="space-y-3.5">
                  <p className="text-[19px] text-black">{title}</p>
                  <p className="text-[14px] leading-[1.6] text-muted">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-8 border-t border-line py-[54px]">
          <div className="max-w-[790px] space-y-5">
            <p className="mono text-[11px] text-rust">TORONTO VOTES OCTOBER 26, 2026</p>
            <h2 className="text-[48px] leading-[1.1] text-black">
              Know what&apos;s changing
              <br />
              in your ward.
            </h2>
            <p className="max-w-[610px] text-[16px] leading-[1.5] text-muted">Local decisions shape your everyday. Explore the proposals near you, then make up your own mind.</p>
          </div>
          <Link href="/ask" className="flex h-12 items-center rounded-full bg-ink px-6 text-[14px] text-white hover:bg-black">
            Start with your address →
          </Link>
        </div>
      </section>

      {/* Footer inset */}
      <footer className="p-4">
        <div className="relative flex flex-col gap-16 overflow-hidden rounded-[24px] bg-soft px-6 pb-8 pt-16 md:px-16">
          <p aria-hidden className="pointer-events-none absolute -bottom-[0.18em] left-[49px] select-none whitespace-nowrap text-[clamp(160px,25vw,360px)] leading-[0.9] text-ink/[0.08]">
            ORDIS
          </p>
          <div className="relative flex flex-wrap items-center justify-between gap-8">
            <div className="max-w-[680px] space-y-[22px]">
              <p className="text-[40px] leading-[1.08] text-black md:text-[54px]">
                See what&apos;s coming
                <br />
                to your block.
              </p>
              <p className="text-[16px] text-muted">Free, neutral, and built on City of Toronto open data.</p>
            </div>
            <div className="flex items-center gap-7">
              <Link href="/ask" className="flex h-12 items-center rounded-full bg-ink px-6 text-[14px] text-white hover:bg-black">
                Enter Ordis →
              </Link>
              {/* Ordi peeking over the edge */}
              <div className="relative h-[140px] w-[120px] overflow-hidden">
                <div className="absolute left-0 top-8">
                  <Ordi size={120} track />
                </div>
              </div>
            </div>
          </div>
          <div className="relative grid grid-cols-2 gap-[60px] md:grid-cols-4">
            {(
              [
                ["Product", [["Ask Ordis", "/ask"], ["3D viewer", "/viewer"], ["Sunlight study", "/viewer"], ["Get involved", "/ask"]]],
                ["Data", [...DATASETS.map(([n, h]) => [`${n} ↗`, h]), ["open.toronto.ca", "https://open.toronto.ca/"]]],
                ["Principles", [["Stated vs estimated", "#principles"], ["Limitations", "#principles"], ["Neutrality", "#principles"]]],
                ["Project", [["About", "#data"], ["Hack the Valley 11 · School of Cities challenge", ""], ["GitHub ↗", "https://github.com/Rahbir1518/HackTheValley11"]]],
              ] as [string, string[][]][]
            ).map(([heading, links]) => (
              <div key={heading} className="space-y-5">
                <p className="text-[12px] text-muted">{heading}</p>
                <div className="space-y-3.5">
                  {links.map(([label, href]) =>
                    href ? (
                      <a key={label} href={href} className={`block text-[13px] leading-[1.5] hover:underline ${label === "open.toronto.ca" ? "text-muted" : "text-ink"}`}>
                        {label}
                      </a>
                    ) : (
                      <p key={label} className="text-[13px] leading-[1.5] text-ink">
                        {label}
                      </p>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="relative space-y-[25px]">
            <div className="h-px bg-line" />
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Identity />
              <p className="text-[10px] text-muted">
                Contains information licensed under the{" "}
                <a href="https://open.toronto.ca/open-data-license/" className="underline" target="_blank" rel="noreferrer">
                  Open Government Licence – Toronto
                </a>
                .
              </p>
              <p className="text-[11px] text-muted">© 2026 Ordis</p>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
