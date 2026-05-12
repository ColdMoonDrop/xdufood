import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const runtimeProcess = (
  globalThis as unknown as { process: { cwd: () => string; env: Record<string, string | undefined> } }
).process;
const projectRoot =
  runtimeProcess.env.npm_config_local_prefix ?? runtimeProcess.env.INIT_CWD ?? runtimeProcess.cwd();
const publicBase = runtimeProcess.env.VITE_PUBLIC_BASE ?? "/";

export default defineConfig({
  root: projectRoot,
  base: publicBase,
  plugins: [react()],
});
