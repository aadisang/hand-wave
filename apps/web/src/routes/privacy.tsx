import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | Hand Wave" },
      {
        name: "description",
        content: "How Hand Wave processes camera and recognition data.",
      },
      { property: "og:url", content: "https://handwave.sh/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://handwave.sh/privacy" }],
  }),
  component: Privacy,
});

const sections = [
  {
    title: "Camera and recognition data",
    body: [
      "Hand Wave processes camera frames on your device to detect hand and pose landmarks. Hand Wave does not upload or retain the camera images themselves.",
      "The resulting landmark coordinates, timing information, and recognition context may be sent to the configured Hand Wave inference service to produce text predictions. Hand Wave does not intentionally retain this recognition data after the real-time request is completed.",
    ],
  },
  {
    title: "Accounts, tracking, and advertising",
    body: [
      "The Hand Wave mobile app does not require an account and does not include advertising, cross-app tracking, or analytics SDKs.",
      "The Hand Wave website uses Vercel Analytics to understand aggregate website performance and usage. This information is not used to track you across other companies' apps or websites.",
    ],
  },
  {
    title: "Connected services",
    body: [
      "If you connect compatible Meta glasses, registration, permissions, and device connectivity are provided by Meta's wearable services and are subject to Meta's own privacy practices.",
    ],
  },
  {
    title: "Retention and security",
    body: [
      "Hand Wave limits processing to what is needed to provide live recognition. Data sent to the inference service is protected using the safeguards available for the configured network connection. Do not use an inference server you do not trust.",
    ],
  },
  {
    title: "Changes and contact",
    body: [
      "This policy may be updated as Hand Wave evolves. Material changes will be reflected on this page. Questions or privacy requests can be sent to mail@aadisanghvi.com.",
    ],
  },
] as const;

function Privacy() {
  return (
    <main
      className="min-h-svh bg-neutral-950 px-6 py-10 text-neutral-100 sm:px-10 sm:py-16"
      id="main"
    >
      <article className="mx-auto max-w-2xl">
        <Link
          className="text-sm text-neutral-500 transition-colors hover:text-neutral-200"
          to="/"
        >
          Hand Wave
        </Link>

        <header className="mb-14 mt-14 border-b border-white/10 pb-10">
          <p className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-neutral-500">
            Effective July 13, 2026
          </p>
          <h1 className="font-heading text-5xl font-semibold tracking-[-0.045em] sm:text-6xl">
            Privacy, plainly.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-neutral-400">
            Hand Wave turns motion into language. Here is what is processed to
            make that happen, and what is not.
          </p>
        </header>

        <div className="space-y-12">
          {sections.map((section, index) => (
            <section
              className="grid gap-4 sm:grid-cols-[2rem_1fr] sm:gap-6"
              key={section.title}
            >
              <span className="pt-1 font-mono text-xs text-neutral-600">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 className="text-xl font-medium tracking-tight">
                  {section.title}
                </h2>
                <div className="mt-4 space-y-4 text-base leading-7 text-neutral-400">
                  {section.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
