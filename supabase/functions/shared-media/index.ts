import { configFromEnv, createHandler } from "./handler.ts";

const handler = createHandler(configFromEnv());

if (typeof Deno !== "undefined") Deno.serve(handler);

export default handler;
