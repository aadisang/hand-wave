import { Outlet } from "@tanstack/react-router";
import { RootDocument } from "./RootDocument";

export function RootRoute() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}
