import type { ReactNode } from "react";
import { HeadContent, Scripts } from "@tanstack/react-router";

type Props = Readonly<{
  children: ReactNode;
}>;

export function RootDocument({ children }: Props) {
  return (
    <html lang="en" className="dark">
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
