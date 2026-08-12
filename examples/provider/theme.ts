import { createContext } from "octane";

export const Theme = createContext<"light" | "dark">("light");
