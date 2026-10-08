import { supabase } from "./supabase";

const endpoint = import.meta.env.VITE_SHARED_MEDIA_URL?.trim();
export const isSharedMediaConfigured = Boolean(endpoint);

async function requestSharedMedia(params: Record<string, string>, body?: Blob, signal?: AbortSignal): Promise<Response> {
  if (!endpoint || !supabase) throw new Error("Archiviazione condivisa non configurata.");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("L’archiviazione condivisa richiede una connessione HTTPS.");
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Accedi di nuovo per usare l’archiviazione.");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers: Record<string, string> = { Authorization: `Bearer ${data.session.access_token}` };
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (apiKey) headers.apikey = apiKey;
  if (body) headers["Content-Type"] = "application/octet-stream";
  let response: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    signal?.throwIfAborted();
    try {
      response = await fetch(url, { method: body ? "POST" : "GET", headers, body, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
      if (![429, 502, 503, 504].includes(response.status) || attempt === 3) break;
      await response.body?.cancel();
    } catch (error) { if (signal?.aborted || attempt === 3) throw error; }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, 1000 * 2 ** attempt);
      function done() {signal?.removeEventListener("abort", cancel); resolve();}
      function cancel() {clearTimeout(timer); signal?.removeEventListener("abort",cancel); reject(signal?.reason);}
      signal?.addEventListener("abort",cancel,{once:true});
    });
  }
  if (!response) throw new Error("Connessione all’archiviazione interrotta.");
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "Accedi di nuovo per usare l’archiviazione.",
      403: "Non hai accesso agli allegati di questa conversazione.",
      404: "Allegato non più disponibile: potrebbe essere scaduto dopo 12 mesi.",
      409: "Caricamento interrotto. Seleziona di nuovo il file e riprova.",
      413: "L’allegato supera la dimensione consentita.",
      429: "Troppi caricamenti in corso. Riprova tra poco.",
      503: "L’archiviazione condivisa non è disponibile. Riprova tra poco.",
      507: "Lo spazio di archiviazione è esaurito.",
    };
    throw new Error(messages[response.status] ?? "Impossibile completare l’operazione di archiviazione.");
  }
  return response;
}

export async function uploadSharedMedia(conversationId: string, attachmentId: string, ciphertext: ArrayBuffer, chunkIndex?: number, signal?: AbortSignal): Promise<string> {
  const response = await requestSharedMedia({ conversationId, attachmentId, ...(chunkIndex === undefined ? {} : { chunkIndex: String(chunkIndex) }) }, new Blob([ciphertext], { type: "application/octet-stream" }), signal);
  const result = await response.json() as { fileId?: unknown };
  if (typeof result.fileId !== "string" || !/^[\w-]{1,200}$/.test(result.fileId)) throw new Error("Risposta di archiviazione non valida.");
  return result.fileId;
}

export async function downloadSharedMedia(conversationId: string, fileId: string, chunkIndex?: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  return (await requestSharedMedia({ conversationId, fileId, ...(chunkIndex === undefined ? {} : { chunkIndex: String(chunkIndex) }) }, undefined, signal)).arrayBuffer();
}

export async function checkSharedMedia(): Promise<boolean> {
  if (!isSharedMediaConfigured) return false;
  const result = await (await requestSharedMedia({ status: "1" })).json() as { configured?: boolean };
  return result.configured === true;
}
