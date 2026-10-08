import { supabase } from "./supabase";

export type SpaceChannel = { id: string; name: string; kind: string; category_id: string | null; position: number; send_permission: "members" | "admins" };
export type SpaceMember = { user_id: string; role: "owner" | "admin" | "member"; username: string; display_name: string };
export type SpaceInvite = { id: string; expires_at: string; use_count: number; max_uses: number; revoked_at: string | null; created_at: string };
export type SpaceBan = { user_id: string; banned_by: string; reason: string | null; created_at: string };
export type SpaceCategory = { id: string; name: string; position: number };

function db() { if (!supabase) throw new Error("Supabase non è configurato"); return supabase; }
export function validateManagementName(value: string, kind: "channel" | "category") { const clean = value.trim(); if (clean.length < 1 || clean.length > 80) throw new Error(`Nome ${kind === "channel" ? "canale" : "categoria"} non valido`); return clean; }
export async function loadSpaceManagement(spaceId: string) {
  const client = db();
  const [channels, members, invites, bans, categories] = await Promise.all([
    client.from("conversations").select("id,name,kind,category_id,position,send_permission").eq("space_id", spaceId).order("position"),
    client.from("space_members").select("user_id,role").eq("space_id", spaceId),
    client.from("space_invites").select("id,expires_at,use_count,max_uses,revoked_at,created_at").eq("space_id", spaceId).order("created_at", { ascending: false }),
    client.from("space_bans").select("user_id,banned_by,reason,created_at").eq("space_id", spaceId),
    client.from("space_categories").select("id,name,position").eq("space_id", spaceId).order("position"),
  ]);
  for (const result of [channels, members, invites, bans, categories]) if (result.error) throw result.error;
  const ids = (members.data ?? []).map(member => member.user_id);
  const profiles = ids.length ? await client.from("profiles").select("id,username,display_name").in("id",ids) : {data:[],error:null};
  if (profiles.error) throw profiles.error;
  const profileById = new Map((profiles.data ?? []).map(profile => [profile.id,profile]));
  return {
    channels: (channels.data ?? []) as SpaceChannel[],
    members: (members.data ?? []).map(member => ({...member,username:profileById.get(member.user_id)?.username??member.user_id,display_name:profileById.get(member.user_id)?.display_name??"Membro"})) as SpaceMember[],
    invites: (invites.data ?? []) as SpaceInvite[], bans: (bans.data ?? []) as SpaceBan[], categories: (categories.data ?? []) as SpaceCategory[],
  };
}
export async function createSpaceCategory(spaceId: string, name: string) { const { data, error } = await db().rpc("create_space_category", { p_space_id: spaceId, p_name: validateManagementName(name, "category") }); if (error) throw error; return data as string; }
export async function deleteSpaceCategory(id: string) { const { error } = await db().rpc("delete_space_category", { p_category_id: id }); if (error) throw error; }
export async function reorderSpaceCategory(id: string, position: number) { if (!Number.isInteger(position) || position < 0) throw new Error("Posizione non valida"); const { error } = await db().rpc("reorder_space_category", { p_category_id: id, p_position: position }); if (error) throw error; }
export async function assignSpaceChannel(id: string, categoryId: string | null, position = 0) { const { error } = await db().rpc("reorder_space_channel", { p_conversation_id: id, p_position: position, p_category_id: categoryId }); if (error) throw error; }
export async function renameSpaceChannel(id: string, name: string) { const { error } = await db().rpc("rename_space_channel", { p_conversation_id: id, p_name: validateManagementName(name, "channel") }); if (error) throw error; }
export async function renameSpaceCategory(id: string, name: string) { const { error } = await db().rpc("rename_space_category", { p_category_id: id, p_name: validateManagementName(name, "category") }); if (error) throw error; }
export async function reorderSpaceChannel(id: string, position: number, categoryId: string | null) { if (!Number.isInteger(position) || position < 0) throw new Error("Posizione non valida"); const { error } = await db().rpc("reorder_space_channel", { p_conversation_id: id, p_position: position, p_category_id: categoryId }); if (error) throw error; }
export async function setConversationSendPermission(id: string, permission: "members" | "admins") { const { error } = await db().rpc("set_conversation_send_permission", { p_conversation_id: id, p_permission: permission }); if (error) throw error; }
export async function manageSpaceMember(spaceId: string, userId: string, role: "member" | "admin") { const { error } = await db().rpc("manage_space_member", { p_space_id: spaceId, p_user_id: userId, p_role: role }); if (error) throw error; }
export async function kickSpaceMember(spaceId: string, userId: string) { const { error } = await db().rpc("kick_space_member", { p_space_id: spaceId, p_user_id: userId }); if (error) throw error; }
export async function setSpaceBan(spaceId: string, userId: string, banned: boolean, reason?: string) { const { error } = await db().rpc("set_space_ban", { p_space_id: spaceId, p_user_id: userId, p_banned: banned, p_reason: reason ?? null }); if (error) throw error; }
export async function revokeSpaceInvite(id: string) { const { error } = await db().rpc("revoke_space_invite", { p_invite_id: id }); if (error) throw error; }
