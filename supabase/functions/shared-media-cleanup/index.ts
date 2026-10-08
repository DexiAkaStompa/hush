import { configFromEnv } from "../shared-media/handler.ts";
import { createCleanupHandler } from "./handler.ts";

const deno = (globalThis as unknown as {Deno: {env: {get: (name: string) => string | undefined}; serve: (handler: (request: Request) => Promise<Response>) => void}}).Deno;
const config = configFromEnv();
const secret = deno.env.get("SHARED_MEDIA_CLEANUP_SECRET") || "";
const handler = createCleanupHandler(config, secret);
const runtime = (globalThis as unknown as {EdgeRuntime?: {waitUntil: (task: Promise<unknown>) => void}}).EdgeRuntime;

deno.serve(async request => {
  const response = await handler(request.clone());
  let input: {automatic?: boolean; passDeleted?: number; step?: number} = {};
  if (response.ok) { try { input = await request.json(); } catch { /* Handler already validates JSON. */ } }
  if (response.ok && input.automatic === true) {
    const result = await response.clone().json() as {dryRun:boolean;deleted:number;nextCursor:string|null};
    const passDeleted = (Number.isSafeInteger(input.passDeleted) && input.passDeleted! >= 0 ? input.passDeleted! : 0) + result.deleted;
    const step = Number.isSafeInteger(input.step) && input.step! >= 0 ? input.step! : 0;
    console.log(JSON.stringify({event:"annual-cleanup",step,deleted:result.deleted,dryRun:result.dryRun}));
    if (!result.dryRun && (result.nextCursor || passDeleted > 0) && step < 20_000 && runtime) {
      const continuation = fetch(`${config.supabaseUrl}/functions/v1/shared-media-cleanup`, {
        method:"POST", headers:{"Content-Type":"application/json","x-hush-cleanup-key":secret},
        body:JSON.stringify({dryRun:false,automatic:true,step:step+1,passDeleted:result.nextCursor?passDeleted:0,...(result.nextCursor?{cursor:result.nextCursor}:{})}),
        signal:AbortSignal.timeout(140_000),
      }).then(next => {if(!next.ok) throw new Error(`Cleanup continuation HTTP ${next.status}`);}).catch(() => {console.error("Annual cleanup continuation failed; the scheduled retry will resume.");});
      runtime.waitUntil(continuation);
    }
  }
  return response;
});
