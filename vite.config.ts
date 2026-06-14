import { defineConfig } from "vite";

// GitHub Pages project site is served from /<repo-name>/.
// In dev, base is "/" so the local server works at the root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/paperball-flick/" : "/",
}));
