import { supabase } from "./supabase";

export const SERVER_PERMISSIONS = [
  {
    id: "send_messages",
    label: "Inviare messaggi",
    description: "Scrivere e condividere allegati nei canali.",
  },
  {
    id: "add_reactions",
    label: "Aggiungere reazioni",
    description: "Aggiungere emoji ai messaggi.",
  },
  {
    id: "connect",
    label: "Entrare in voce",
    description: "Collegarsi alle chiamate e alle stanze vocali.",
  },
  {
    id: "mention_everyone",
    label: "Menzionare tutti",
    description: "Usare @everyone, @here e i ruoli non menzionabili.",
  },
  {
    id: "pin_messages",
    label: "Fissare messaggi",
    description: "Gestire i messaggi fissati della conversazione.",
  },
  {
    id: "manage_messages",
    label: "Moderare messaggi",
    description: "Eliminare anche i messaggi degli altri membri.",
  },
] as const;
export type ServerPermission = (typeof SERVER_PERMISSIONS)[number]["id"];
export type SpaceRole = {
  id: string;
  space_id: string;
  name: string;
  color: string;
  position: number;
  is_default: boolean;
  mentionable: boolean;
  permissions: ServerPermission[];
};
export type RoleAssignment = {
  space_id: string;
  user_id: string;
  role_id: string;
};
export type ChannelOverride = {
  conversation_id: string;
  role_id: string;
  allow_permissions: ServerPermission[];
  deny_permissions: ServerPermission[];
};
export type ServerRoleContext = {
  roles: SpaceRole[];
  assignments: RoleAssignment[];
  memberships: { user_id: string; role: string }[];
  overrides: ChannelOverride[];
};
export const EMPTY_ROLE_CONTEXT: ServerRoleContext = {
  roles: [],
  assignments: [],
  memberships: [],
  overrides: [],
};
function db() {
  if (!supabase) throw new Error("Supabase non è configurato");
  return supabase;
}

export async function loadServerRoles(
  spaceId: string,
): Promise<ServerRoleContext> {
  const [roles, assignments, memberships] = await Promise.all([
    db()
      .from("space_roles")
      .select("*")
      .eq("space_id", spaceId)
      .order("position"),
    db()
      .from("space_member_roles")
      .select("space_id,user_id,role_id")
      .eq("space_id", spaceId),
    db().from("space_members").select("user_id,role").eq("space_id", spaceId),
  ]);
  for (const r of [roles, assignments, memberships]) if (r.error) throw r.error;
  const ids = (roles.data ?? []).map((r) => r.id);
  const overrides = ids.length
    ? await db().from("channel_role_overrides").select("*").in("role_id", ids)
    : { data: [], error: null };
  if (overrides.error) throw overrides.error;
  return {
    roles: (roles.data ?? []) as SpaceRole[],
    assignments: assignments.data ?? [],
    memberships: memberships.data ?? [],
    overrides: (overrides.data ?? []) as ChannelOverride[],
  };
}
export async function loadChannelPermissions(ids: string[]) {
  if (!ids.length) return {} as Record<string, ServerPermission[]>;
  const { data, error } = await db().rpc("get_conversation_permissions", {
    p_conversation_ids: ids,
  });
  if (error) throw error;
  return Object.fromEntries(
    (data ?? []).map(
      (r: { conversation_id: string; permissions: ServerPermission[] }) => [
        r.conversation_id,
        r.permissions,
      ],
    ),
  ) as Record<string, ServerPermission[]>;
}
export async function saveSpaceRole(
  spaceId: string,
  role: Pick<SpaceRole, "name" | "color" | "permissions" | "mentionable"> & {
    id?: string;
  },
) {
  const { data, error } = await db().rpc("save_space_role", {
    p_space_id: spaceId,
    p_role_id: role.id ?? null,
    p_name: role.name.trim(),
    p_color: role.color,
    p_permissions: role.permissions,
    p_mentionable: role.mentionable,
  });
  if (error) throw error;
  return data as string;
}
export async function deleteSpaceRole(id: string) {
  const { error } = await db().rpc("delete_space_role", { p_role_id: id });
  if (error) throw error;
}
export async function setMemberRoles(
  spaceId: string,
  userId: string,
  roleIds: string[],
) {
  const { error } = await db().rpc("set_member_space_roles", {
    p_space_id: spaceId,
    p_user_id: userId,
    p_role_ids: roleIds,
  });
  if (error) throw error;
}
export async function saveChannelOverride(
  conversationId: string,
  roleId: string,
  allow: ServerPermission[],
  deny: ServerPermission[],
) {
  const { error } = await db().rpc("save_channel_role_override", {
    p_conversation_id: conversationId,
    p_role_id: roleId,
    p_allow: allow,
    p_deny: deny,
  });
  if (error) throw error;
}
export async function reorderChannels(spaceId: string, ids: string[]) {
  const { error } = await db().rpc("reorder_space_channels", {
    p_space_id: spaceId,
    p_order: ids,
  });
  if (error) throw error;
}
export function rolesForUser(context: ServerRoleContext, userId: string) {
  const ids = new Set(
    context.assignments
      .filter((a) => a.user_id === userId)
      .map((a) => a.role_id),
  );
  return context.roles
    .filter((r) => ids.has(r.id) && !r.is_default)
    .sort((a, b) => b.position - a.position);
}
export function canMassMention(
  context: ServerRoleContext,
  userId: string,
  conversationId?: string,
) {
  const admin = context.memberships.some(
    (m) => m.user_id === userId && ["owner", "admin"].includes(m.role),
  );
  if (admin) return true;
  const assigned = new Set(
    context.assignments
      .filter((a) => a.user_id === userId)
      .map((a) => a.role_id),
  );
  let allowed = context.roles.some(
    (r) =>
      (r.is_default || assigned.has(r.id)) &&
      r.permissions.includes("mention_everyone"),
  );
  const everyone = context.roles.find((r) => r.is_default);
  const overrides = context.overrides.filter(
    (o) => o.conversation_id === conversationId,
  );
  const base = overrides.find((o) => o.role_id === everyone?.id);
  if (base?.deny_permissions.includes("mention_everyone")) allowed = false;
  if (base?.allow_permissions.includes("mention_everyone")) allowed = true;
  const custom = overrides.filter((o) => assigned.has(o.role_id));
  if (custom.some((o) => o.deny_permissions.includes("mention_everyone")))
    allowed = false;
  if (custom.some((o) => o.allow_permissions.includes("mention_everyone")))
    allowed = true;
  return allowed;
}
