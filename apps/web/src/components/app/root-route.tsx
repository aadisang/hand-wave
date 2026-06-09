import { HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import type { ReactNode } from "react";

export function RootComponent() {
  return <Outlet />;
}

export function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className="dark" lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
        <Analytics />
        <Scripts />
      </body>
    </html>
  );
}
