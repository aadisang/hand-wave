/// <reference types="vite/client" />

import { createRootRoute } from "@tanstack/react-router";
import { NotFound } from "@/components/app/not-found";
import { RootComponent, RootDocument } from "@/components/app/root-route";
import { appJsonLd, homeUrl, site } from "@/config/site";
import {
  handModelUrl,
  poseModelUrl,
  visionWasmBinaryUrl,
  visionWasmScriptUrl,
} from "@/lib/mediapipe/assets";
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
      {
        rel: "preload",
        href: "/fonts/Satoshi-Variable.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/favicon.svg" },
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
      {
        rel: "preload",
        as: "fetch",
        href: visionWasmBinaryUrl,
        type: "application/wasm",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "script",
        href: visionWasmScriptUrl,
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "fetch",
        href: handModelUrl,
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "fetch",
        href: poseModelUrl,
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
