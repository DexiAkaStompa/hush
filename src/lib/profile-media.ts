import { supabase } from "./supabase";
import type { Profile } from "./workspace";

export const PROFILE_IMAGE_LIMIT = 8 * 1024 * 1024;
const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
export function validateProfileImage(file: Pick<File, "type" | "size">) {
  if (!extensions[file.type]) throw new Error("Scegli un’immagine PNG, JPG, GIF o WebP.");
  if (file.size === 0 || file.size > PROFILE_IMAGE_LIMIT) throw new Error("L’immagine deve essere compresa tra 1 byte e 8 MB.");
}
export async function previewProfileImage(file: File) {
  validateProfileImage(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error("Usa un’immagine di massimo 4096 × 4096 pixel.");
    return url;
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export async function saveProfile(profile: Profile, draft: Pick<Profile, "display_name" | "avatar_color" | "bio">,
  media: { avatar: File | null | undefined; banner: File | null | undefined }) {
  if (!supabase) throw new Error("Connessione non disponibile.");
  const client = supabase;
  const bucket = client.storage.from("profile-media");
  const uploaded: string[] = [];
  const patch: Partial<Profile> = { ...draft, display_name: draft.display_name.trim() };
  if (!patch.display_name || patch.display_name.length > 64) throw new Error("Il nome deve contenere da 1 a 64 caratteri.");
  if ((patch.bio?.length ?? 0) > 190 || !/^#[0-9a-f]{6}$/i.test(draft.avatar_color)) throw new Error("Controlla biografia e colore.");
  try {
    for (const kind of ["avatar", "banner"] as const) {
      const file = media[kind];
      if (file === undefined) continue;
      if (file === null) { patch[`${kind}_path`] = null; continue; }
      validateProfileImage(file);
      const path = `${profile.id}/${crypto.randomUUID()}.${extensions[file.type]}`;
      const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false, cacheControl: "31536000" });
      if (error) throw error;
      uploaded.push(path);
      patch[`${kind}_path`] = path;
    }
    const { data, error } = await client.from("profiles").update(patch).eq("id", profile.id).select("*").single();
    if (error) throw error;
    // Only remove replaced files after the profile update has succeeded.
    const replaced = (["avatar_path", "banner_path"] as const).flatMap((field) =>
      patch[field] !== undefined && profile[field] && patch[field] !== profile[field] ? [profile[field]!] : []);
    if (replaced.length) void bucket.remove(replaced).catch(() => undefined);
    return data as Profile;
  } catch (error) {
    if (uploaded.length) await bucket.remove(uploaded).catch(() => undefined);
    if (error && typeof error === "object" && "message" in error && /column|schema cache|bucket not found/i.test(String(error.message))) {
      throw new Error("I profili con immagini non sono ancora attivi sul server. Applica la migrazione profile_media e riprova.");
    }
    throw error;
  }
}
