import { Outlet } from "@tanstack/react-router";
import { RootDocument } from "./root-document";

export function RootRoute() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}
