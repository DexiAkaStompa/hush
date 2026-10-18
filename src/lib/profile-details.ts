import { supabase } from "./supabase";
import type { Space } from "./workspace";
export type SharedProfileSpace = { space: Space; joinedAt: string };
export async function loadSharedProfileSpaces(
  userId: string,
  spaces: Space[],
): Promise<SharedProfileSpace[]> {
  if (!supabase || !spaces.length) return [];
  const { data, error } = await supabase
    .from("space_members")
    .select("space_id,joined_at")
    .eq("user_id", userId)
    .in(
      "space_id",
      spaces.map((s) => s.id),
    );
  if (error) throw error;
  const membership = new Map(
    (data ?? []).map((m) => [m.space_id, m.joined_at]),
  );
  return spaces
    .filter((s) => membership.has(s.id))
    .map((space) => ({ space, joinedAt: membership.get(space.id)! }));
}
export type ProfileAnchor = Pick<DOMRect, "left" | "right" | "top" | "bottom">;
export function profilePopoverPosition(
  anchor: ProfileAnchor,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const gap = 12,
    margin = 12;
  const right = anchor.right + gap,
    left = anchor.left - width - gap;
  const x =
    right + width <= viewportWidth - margin
      ? right
      : left >= margin
        ? left
        : Math.max(
            margin,
            Math.min(anchor.left, viewportWidth - width - margin),
          );
  return {
    left: x,
    top: Math.max(
      margin,
      Math.min(anchor.top, viewportHeight - height - margin),
    ),
  };
}
