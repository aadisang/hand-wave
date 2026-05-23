/// <reference types="vite/client" />

import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { NotFound } from "@/components/app/not-found";
import {
  handLandmarkerModelPath,
  poseLandmarkerModelPath,
} from "@/hooks/use-hand-landmarker";
import appCss from "./globals.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0a0a0a" },
      { name: "robots", content: "index, follow" },
      {
        name: "description",
        content: "Real-time sign language recognition for the browser.",
      },
      { title: "Hand Wave" },
      { property: "og:title", content: "Hand Wave" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Hand Wave" },
      {
        property: "og:description",
        content: "Real-time sign language recognition for the browser.",
      },
      { property: "og:image", content: "/favicon.svg" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Hand Wave" },
      {
        name: "twitter:description",
        content: "Real-time sign language recognition for the browser.",
      },
      { name: "twitter:image", content: "/favicon.svg" },
    ],
    links: [
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
        href: handLandmarkerModelPath,
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        as: "fetch",
        href: poseLandmarkerModelPath,
        crossOrigin: "anonymous",
      },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
});

function RootComponent() {
  return <Outlet />;
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className="dark" lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
