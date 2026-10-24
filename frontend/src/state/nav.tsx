import { createContext, useContext, useState, type ReactNode } from "react";

export type Route =
  | { page: "home" }
  | { page: "search"; query?: string }
  | { page: "domains" }
  | { page: "send"; to?: string }
  | { page: "tx" }
  | { page: "auction"; id: bigint; domain?: string };

interface NavState { route: Route; go: (r: Route) => void }
const Ctx = createContext<NavState>(null as unknown as NavState);
export const useNav = () => useContext(Ctx);

export function NavProvider({ children }: { children: ReactNode }) {
  const [route, go] = useState<Route>({ page: "home" });
  return <Ctx.Provider value={{ route, go }}>{children}</Ctx.Provider>;
}
