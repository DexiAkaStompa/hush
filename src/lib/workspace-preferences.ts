export type WorkspacePreferences = { pinned: string[]; favorites: string[]; serverOrder: string[]; hiddenMuted: string[] };
export const emptyPreferences = (): WorkspacePreferences => ({ pinned: [], favorites: [], serverOrder: [], hiddenMuted: [] });
export function readWorkspacePreferences(userId: string): WorkspacePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(`hush:workspace:${userId}`) ?? "{}");
    const result = emptyPreferences();
    for (const field of Object.keys(result) as (keyof WorkspacePreferences)[]) result[field] = Array.isArray(value[field]) ? [...new Set(value[field].filter((id: unknown): id is string => typeof id === "string"))] as string[] : [];
    return result;
  } catch { return emptyPreferences(); }
}
export function saveWorkspacePreferences(userId: string, value: WorkspacePreferences) { try { localStorage.setItem(`hush:workspace:${userId}`, JSON.stringify(value)); } catch { /* Session state remains usable if storage is full. */ } }
export function togglePreference(values: string[], id: string) { return values.includes(id) ? values.filter(value => value !== id) : [...values, id]; }
export function sortWorkspaceItems<T extends { id: string }>(items: T[], order: string[]) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (positions.get(a.id) ?? order.length) - (positions.get(b.id) ?? order.length));
}
