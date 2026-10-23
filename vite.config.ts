import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "127.0.0.1",
  },
  test: {
    environment: "node",
    // Database suites each start a WASM Postgres instance; bound their memory use.
    maxWorkers: 2,
  },
});
