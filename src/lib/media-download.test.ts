import { afterEach, expect, test, vi } from "vitest";
const mocks=vi.hoisted(()=>({download:vi.fn()}));
vi.mock("./chunked-media",()=>({downloadChunkedMedia:mocks.download}));
vi.mock("./chat-media",()=>({downloadAndDecryptChatImage:vi.fn(),releaseChatMediaCacheEntry:vi.fn()}));
import { saveChatAttachment } from "./media-download";
const attachment={id:"id",path:"gdrive-shared:file",size:20*1024*1024,name:"large.zip",type:"application/zip",iv:"iv",encryption:"chunked-v1" as const};
afterEach(()=>{vi.unstubAllGlobals();vi.resetAllMocks();});

test("browser disk streams keep their receiver while writing and completing",async()=>{
  const writes:number[]=[];
  const stream={closed:false,async write(bytes:Uint8Array){expect(this).toBe(stream);writes.push(...bytes);},async close(){expect(this).toBe(stream);this.closed=true;},abort:vi.fn()};
  vi.stubGlobal("window",{showSaveFilePicker:async()=>({createWritable:async()=>stream})});
  mocks.download.mockImplementation(async(_attachment,_conversation,_key,write)=>{await write(new Uint8Array([1,2]));await write(new Uint8Array([3]));});
  await saveChatAttachment(attachment,"conversation",{} as CryptoKey);
  expect(writes).toEqual([1,2,3]);expect(stream.closed).toBe(true);expect(stream.abort).not.toHaveBeenCalled();
});

test("a failed streamed download aborts the disk writer instead of finalizing a partial file",async()=>{
  const stream={write:vi.fn(),close:vi.fn(),abort:vi.fn().mockResolvedValue(undefined)};
  vi.stubGlobal("window",{showSaveFilePicker:async()=>({createWritable:async()=>stream})});
  mocks.download.mockRejectedValue(new Error("authentication failed"));
  await expect(saveChatAttachment(attachment,"conversation",{} as CryptoKey)).rejects.toThrow("authentication failed");
  expect(stream.abort).toHaveBeenCalledOnce();expect(stream.close).not.toHaveBeenCalled();
});
