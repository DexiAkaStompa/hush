import { supabase } from "./supabase";

export type CommunityIdentity = {
  name: string;
  description?: string;
  accent_color?: string;
  icon_data?: string | null;
  banner_data?: string | null;
  identity_customized?: boolean;
};
export const IDENTITY_COLORS = [
  "#73b7ff",
  "#9b8afb",
  "#e59dce",
  "#edaa73",
  "#6bc8b5",
  "#dbb85b",
];
export function safeCommunityImage(value?: string | null): string | undefined {
  return value &&
    value.length <= 131072 &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    ? value
    : undefined;
}
export function identityColor(value?: string): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : IDENTITY_COLORS[0];
}
export async function prepareCommunityImage(
  file: File,
  kind: "icon" | "banner",
): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 8 * 1024 * 1024 ||
    !file.size
  )
    throw new Error("Scegli un’immagine PNG, JPG o WebP fino a 8 MB.");
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = kind === "icon" ? 128 : 960;
    canvas.height = kind === "icon" ? 128 : 320;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Impossibile elaborare l’immagine.");
    const ratio = Math.max(
      canvas.width / image.width,
      canvas.height / image.height,
    );
    const width = canvas.width / ratio,
      height = canvas.height / ratio;
    context.drawImage(
      image,
      (image.width - width) / 2,
      (image.height - height) / 2,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const limit = kind === "icon" ? 32768 : 131072;
    for (const quality of [0.82, 0.65, 0.45, 0.25]) {
      const data = canvas.toDataURL("image/webp", quality);
      if (data.length <= limit) return data;
    }
    throw new Error(
      "L’immagine è troppo dettagliata. Prova con un’immagine più semplice.",
    );
  } finally {
    image.close();
  }
}
export async function saveCommunityIdentity(
  kind: "space" | "conversation",
  id: string,
  identity: CommunityIdentity,
) {
  if (!supabase) throw new Error("Connessione non disponibile.");
  const { error } = await supabase.rpc("update_community_identity", {
    p_kind: kind,
    p_id: id,
    p_name: identity.name.trim(),
    p_description: identity.description || "",
    p_accent: identityColor(identity.accent_color),
    p_icon: identity.icon_data || null,
    p_banner: identity.banner_data || null,
  });
  if (error) throw error;
}
