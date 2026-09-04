import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function ProfileImage({ path, preview, alt, className }: { path?: string | null; preview?: string; alt: string; className?: string }) {
  const [image, setImage] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!path || preview || !supabase) return;
    let active = true;
    let url: string | undefined;
    void supabase.storage.from("profile-media").download(path).then(({ data }) => {
      if (!data || !active) return;
      url = URL.createObjectURL(data);
      setImage({ path, url });
    }).catch(() => undefined);
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [path, preview]);
  const src = preview ?? (image && image.path === path ? image.url : undefined);
  return src ? <img key={src} className={className} src={src} alt={alt} onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null;
}
