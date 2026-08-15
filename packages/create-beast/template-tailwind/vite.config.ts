import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { beastOctane } from "beast-tsrx/vite";

export default defineConfig({
  plugins: [tailwindcss(), beastOctane()],
});
