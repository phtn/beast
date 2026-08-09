/// <reference types="vite/client" />

declare module "*.btsx" {
  import type { ComponentBody } from "octane";

  const component: ComponentBody;
  export default component;
}
