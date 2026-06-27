/// <reference types="vite/client" />

import { createRootRoute } from "@tanstack/react-router";
import { NotFound } from "@/components/app/not-found";
import { RootComponent, RootDocument } from "@/components/app/root-route";
import { appJsonLd, homeUrl, site } from "@/config/site";
import appCss from "./globals.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0a0a0a" },
      { name: "robots", content: "index, follow" },
      { name: "description", content: site.description },
      { title: site.title },
      { property: "og:title", content: site.title },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: site.name },
      { property: "og:url", content: homeUrl },
      { property: "og:description", content: site.description },
      { property: "og:image", content: site.image },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: site.title },
      { name: "twitter:description", content: site.description },
      { name: "twitter:image", content: site.image },
    ],
    links: [
      { rel: "canonical", href: homeUrl },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "alternate icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      {
        rel: "preconnect",
        href: "https://storage.googleapis.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "preconnect",
        href: "https://cdn.jsdelivr.net",
        crossOrigin: "anonymous",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(appJsonLd),
      },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
});
