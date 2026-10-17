import Link from "next/link";
import ScrollStory from "@/components/landing/ScrollStory";

const DATASETS = [
  {
    name: "Development Applications",
    use: "What is proposed, its status, and the official record",
    href: "https://open.toronto.ca/dataset/development-applications/",
  },
  {
    name: "Property Boundaries",
    use: "The lot each building would sit on",
    href: "https://open.toronto.ca/dataset/property-boundaries/",
  },
  {
    name: "3D Massing",
    use: "Every existing building and its height",
    href: "https://open.toronto.ca/dataset/3d-massing/",
  },
  {
    name: "Address Points",
    use: "Turning your address into a location",
    href: "https://open.toronto.ca/dataset/address-points-municipal-toronto-one-address-repository/",
  },
  {
    name: "Neighbourhood Profiles",
    use: "Who rents, what housing costs, in your neighbourhood (2021 Census)",
    href: "https://open.toronto.ca/dataset/neighbourhood-profiles/",
  },
  {
    name: "Street Tree Data",
    use: "The trees on your street",
    href: "https://open.toronto.ca/dataset/street-tree-data/",
  },
];

const PRINCIPLES = [
  ["Stated vs estimated", "Every number is labelled. When an application doesn't say something, Ordis shows the rule it used to estimate it."],
  ["No fabricated buildings", "If an application doesn't describe a building, or the AI isn't confident, Ordis says so instead of guessing."],
  ["A model, not a promise", "Footprints come from property lines and heights from the application text. It's a massing approximation, not an architectural rendering."],
  ["Neutral", "Ordis explains what's proposed. It doesn't argue for or against any development."],
];

export default function Home() {
  return (
    <main className="bg-paper text-asphalt">
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-concrete/60 bg-paper/80 px-6 backdrop-blur-md md:px-16">
        <Link href="/" className="flex items-center gap-3 text-sm">
          <span className="grid h-7 w-7 place-items-center rounded-sm bg-asphalt text-xs font-black text-white">O</span>
          <span className="font-semibold tracking-[0.2em]">ORDIS</span>
          <span className="hidden text-steel md:inline">| What&apos;s being built near you</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <a href="#data" className="hidden text-steel hover:text-asphalt md:inline">
            Data
          </a>
          <a href="#principles" className="hidden text-steel hover:text-asphalt md:inline">
            Principles
          </a>
          <Link href="/sign-in" className="hidden text-steel hover:text-asphalt md:inline">
            Sign in
          </Link>
          <Link href="/viewer" className="rounded-full border border-asphalt px-4 py-1.5 font-medium hover:bg-asphalt hover:text-white">
            Enter Ordis
          </Link>
        </nav>
      </header>

      <ScrollStory />

      {/* Data */}
      <section id="data" className="border-t border-concrete bg-white px-6 py-28 md:px-16">
        <div className="grid gap-16 md:grid-cols-[1fr_1.4fr]">
          <div>
            <span className="font-mono text-sm tracking-[0.3em] text-permit">OPEN DATA</span>
            <h2 className="mt-3 text-5xl font-semibold leading-tight tracking-tight">Built on the City&apos;s own records.</h2>
            <p className="mt-6 max-w-md text-lg text-steel">
              Every model starts from City of Toronto Open Data, downloaded and stored locally, with a link back to each
              source.
            </p>
            <dl className="mt-10 grid grid-cols-3 gap-6">
              {[
                ["26k+", "development applications"],
                ["428k", "3D buildings"],
                ["688k", "street trees"],
              ].map(([n, l]) => (
                <div key={l}>
                  <dt className="text-4xl font-semibold tracking-tight">{n}</dt>
                  <dd className="mt-1 text-sm text-steel">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <ul className="divide-y divide-concrete border-y border-concrete">
            {DATASETS.map((d) => (
              <li key={d.name}>
                <a href={d.href} target="_blank" rel="noreferrer" className="group flex items-center justify-between gap-6 py-5">
                  <div>
                    <p className="text-xl font-medium">{d.name}</p>
                    <p className="text-sm text-steel">{d.use}</p>
                  </div>
                  <span className="text-2xl text-steel transition-transform group-hover:translate-x-1 group-hover:text-permit">→</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Principles */}
      <section id="principles" className="bg-asphalt px-6 py-28 text-white md:px-16">
        <span className="font-mono text-sm tracking-[0.3em] text-permit">HONEST BY DESIGN</span>
        <h2 className="mt-3 max-w-3xl text-5xl font-semibold leading-tight tracking-tight">
          Clear about what it knows, and what it doesn&apos;t.
        </h2>
        <div className="mt-16 grid gap-px bg-[#2a2a2a] md:grid-cols-4">
          {PRINCIPLES.map(([title, body], i) => (
            <div key={title} className="bg-asphalt p-6 pr-10">
              <span className="font-mono text-xs text-steel">0{i + 1}</span>
              <p className="mt-6 text-lg font-medium">{title}</p>
              <p className="mt-3 text-sm leading-relaxed text-[#a3a3a0]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Election + CTA */}
      <section className="bg-paper px-6 py-28 md:px-16">
        <div className="grid items-end gap-12 md:grid-cols-2">
          <div>
            <span className="font-mono text-sm tracking-[0.3em] text-permit">TORONTO VOTES · OCTOBER 26, 2026</span>
            <h2 className="mt-3 text-5xl font-semibold leading-tight tracking-tight">Know what&apos;s changing in your ward.</h2>
            <p className="mt-6 max-w-lg text-lg text-steel">
              Housing and development are decided locally. Ordis shows the applications on your block and the
              activity across your ward, so you can ask better questions, whoever you vote for.
            </p>
          </div>
          <div className="flex flex-col items-start gap-4 md:items-end">
            <Link href="/viewer" className="rounded-full bg-asphalt px-8 py-4 text-lg font-semibold text-white hover:bg-permit hover:text-asphalt">
              Start with your address →
            </Link>
            <p className="text-sm text-steel">Free. Sign in to use the 3D viewer.</p>
          </div>
        </div>
      </section>

      <footer className="flex flex-col gap-2 border-t border-concrete px-6 py-8 text-xs text-steel md:flex-row md:justify-between md:px-16">
        <span>Ordis · Built at Hack the Valley 11 for the Hack the Valley x School of Cities challenge.</span>
        <span>
          Contains information licensed under the{" "}
          <a className="underline" href="https://open.toronto.ca/open-data-license/" target="_blank" rel="noreferrer">
            Open Government Licence – Toronto
          </a>
          .
        </span>
      </footer>
    </main>
  );
}
