import { createRoot } from "octane";
import App from "./App.btsx";
import "./style.css";

const container = document.getElementById("app");
if (container === null) throw new Error("Missing #app container.");

createRoot(container).render(App, { title: "Beast + Octane" });
