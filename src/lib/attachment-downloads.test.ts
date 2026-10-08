import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { afterEach, expect, test } from "vitest";
const { registerAttachmentDownloads } = createRequire(import.meta.url)("../../electron/attachment-downloads.cjs");
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    for (const name of await readdir(directory)) await unlink(path.join(directory,name));
    await rmdir(directory);
  }
});
async function harness() {
  const directory = await mkdtemp(path.join(tmpdir(),"hush-download-test-")); directories.push(directory);
  const destination = path.join(directory,"output.bin");
  const handlers = new Map<string,(...args:any[])=>Promise<any>>();
  const sender = Object.assign(new EventEmitter(),{id:1}); const event={sender,trusted:true};
  registerAttachmentDownloads({ipcMain:{handle:(name:string,handler:any)=>handlers.set(name,handler)},dialog:{showSaveDialog:async()=>({filePath:destination,canceled:false})},windowForEvent:(event:any)=>event.trusted?{}:null});
  const invoke = (name:string,...args:any[]) => handlers.get("attachment:save-"+name)!(event,...args);
  return {directory,destination,event,handlers,invoke};
}

test("native downloads preserve the destination until complete and save chunks in order", async () => {
  const h=await harness(); await writeFile(h.destination,new Uint8Array([9]));
  const token=await h.invoke("begin","output.bin");
  await h.invoke("write",token,0,new Uint8Array([1,2]));
  await h.invoke("write",token,1,new Uint8Array([3,4]));
  expect([...await readFile(h.destination)]).toEqual([9]);
  await h.invoke("finish",token);
  expect([...await readFile(h.destination)]).toEqual([1,2,3,4]);
  expect(await readdir(h.directory)).toEqual(["output.bin"]);
  expect(h.event.sender.listenerCount("destroyed")).toBe(0);
});

test("cancellation removes only the incomplete temporary file", async () => {
  const h=await harness(); await writeFile(h.destination,new Uint8Array([9]));
  const token=await h.invoke("begin","output.bin"); await h.invoke("write",token,0,new Uint8Array([1]));
  await h.invoke("abort",token);
  expect([...await readFile(h.destination)]).toEqual([9]);
  expect(await readdir(h.directory)).toEqual(["output.bin"]);
});

test("native writer rejects foreign senders, untrusted frames, and out of order blocks", async () => {
  const h=await harness(); const token=await h.invoke("begin","output.bin");
  const write=h.handlers.get("attachment:save-write")!;
  await expect(write({sender:{id:2},trusted:true},token,0,new Uint8Array([1]))).rejects.toThrow();
  await expect(write({sender:h.event.sender,trusted:false},token,0,new Uint8Array([1]))).rejects.toThrow();
  await expect(h.invoke("write",token,2,new Uint8Array([1]))).rejects.toThrow();
  await h.invoke("abort",token);
});
