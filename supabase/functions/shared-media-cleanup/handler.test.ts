import { afterEach, expect, test, vi } from "vitest";
import { createCleanupHandler, eligibleForCleanup, retentionCutoff } from "./handler";
import { resetTokenCacheForTests, type SharedMediaConfig } from "../shared-media/handler";
const conv = "22222222-2222-4222-8222-222222222222";
const attachment = "33333333-3333-4333-8333-333333333333";
const folder = "folder_123456789";
const secret = "test-cleanup-secret-which-is-at-least-32-characters";
const config: SharedMediaConfig = {supabaseUrl:"",supabasePublishableKey:"",googleClientId:"client",googleClientSecret:"secret",googleRefreshToken:"refresh",googleFolderId:folder,allowedOrigins:new Set()};
const oldFile = {id:"file_123456789",name:`${conv}-${attachment}.bin`,mimeType:"application/octet-stream",parents:[folder],createdTime:"2024-10-08T00:00:00Z",appProperties:{conversationId:conv,attachmentId:attachment}};
const now = () => new Date("2026-10-09T00:00:00Z");
const request = (body: unknown, key = secret) => new Request("https://cleanup.example", {method:"POST",headers:{"x-hush-cleanup-key":key},body:JSON.stringify(body)});
afterEach(resetTokenCacheForTests);

test("cleanup excludes recent files, folders, unrelated files, and files outside Hush", () => {
  const cutoff = retentionCutoff(now());
  expect(eligibleForCleanup(oldFile,folder,cutoff)).toBe(true);
  for (const changed of [{createdTime:cutoff.toISOString()},{createdTime:"invalid"},{parents:["other-folder"]},{mimeType:"application/vnd.google-apps.folder"},{trashed:true},{name:"personal.bin",appProperties:{}},{id:"../invalid"}]) expect(eligibleForCleanup({...oldFile,...changed},folder,cutoff)).toBe(false);
});

test("retention handles leap years and preserves time of day", () => {
  expect(retentionCutoff(new Date("2024-02-29T12:34:00Z")).toISOString()).toBe("2023-02-28T12:34:00.000Z");
  expect(retentionCutoff(now()).toISOString()).toBe("2025-10-09T00:00:00.000Z");
});

test("unauthorized requests cannot contact Google or delete files", async () => {
  const fetchMock = vi.fn();
  const r = await createCleanupHandler(config,secret,fetchMock,now)(request({dryRun:false},"wrong"));
  expect(r.status).toBe(401); expect(fetchMock).not.toHaveBeenCalled();
});

test("scheduled HMAC requests bind the body and reject expired signatures",async()=>{
  const body='{"dryRun":true}';const timestamp=String(Math.floor(now().getTime()/1000));
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sign=async(time:string,text:string)=>[...new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`hush-drive-cleanup:${time}:${text}`)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  const signed=async(time:string,signedBody:string,actualBody=signedBody)=>new Request("https://cleanup.example",{method:"POST",headers:{"x-hush-cleanup-timestamp":time,"x-hush-cleanup-signature":await sign(time,signedBody)},body:actualBody});
  const fetchMock=vi.fn(async(input:RequestInfo|URL)=>String(input).includes("oauth2")?Response.json({access_token:"token"}):Response.json({files:[]}));
  const handler=createCleanupHandler(config,secret,fetchMock,now);
  expect((await handler(await signed(timestamp,body))).status).toBe(200);
  fetchMock.mockClear();
  expect((await handler(await signed(timestamp,body,'{"dryRun":false}'))).status).toBe(401);
  expect((await handler(await signed(String(Number(timestamp)-121),body))).status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("dry run is the default and never deletes anything", async () => {
  const fetchMock = vi.fn(async (input:RequestInfo|URL) => String(input).includes("oauth2") ? Response.json({access_token:"token"}) : Response.json({files:[oldFile]}));
  const r = await createCleanupHandler(config,secret,fetchMock,now)(request({}));
  expect(await r.json()).toMatchObject({dryRun:true,eligible:1,deleted:0,nextCursor:null});
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("live cleanup rechecks file scope and permanently deletes only eligible files", async () => {
  const moved = {...oldFile,id:"moved_123456789"};
  const fetchMock = vi.fn(async (input:RequestInfo|URL,init?:RequestInit) => {
    const url = String(input);
    if(url.includes("oauth2"))return Response.json({access_token:"token"});
    if(init?.method==="DELETE")return new Response(null,{status:204});
    if(url.includes("/files?"))return Response.json({files:[oldFile,moved],nextPageToken:"next-page"});
    return Response.json(url.includes("moved_")?{...moved,parents:["outside-folder"]}:oldFile);
  });
  const r = await createCleanupHandler(config,secret,fetchMock,now)(request({dryRun:false}));
  expect(await r.json()).toMatchObject({eligible:2,deleted:1,skipped:1,nextCursor:"next-page"});
  expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="DELETE")).toHaveLength(1);
});
