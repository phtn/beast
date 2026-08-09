import { defineConfig } from "vite";
import { beastOctane } from "beast-tsrx/vite";

export default defineConfig({
  plugins: [
    beastOctane({
      components: {
        "src/App.btsx": {
          propsParam: "{ title }: { title: string }",
        },
      },
    }),
  ],
});
