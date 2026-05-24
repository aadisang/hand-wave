export const site = {
  name: "Hand Wave",
  title: "Hand Wave - Real-Time Sign Language Recognition",
  description:
    "Real-time sign language recognition for camera and screen share.",
  origin: "https://handwave.sh",
  image: "https://handwave.sh/og.png",
} as const;

export const homeUrl = `${site.origin}/`;

export const appJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: site.name,
  url: homeUrl,
  applicationCategory: "AccessibilityApplication",
  operatingSystem: "Web",
  description: site.description,
} as const;
