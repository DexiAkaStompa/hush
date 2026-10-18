import { describe, it, expect } from "vitest";
import {
  canMassMention,
  rolesForUser,
  type ServerRoleContext,
} from "./server-roles";
const base: ServerRoleContext = {
  roles: [
    {
      id: "everyone",
      space_id: "s",
      name: "everyone",
      color: "#ffffff",
      position: 0,
      is_default: true,
      mentionable: true,
      permissions: [],
    },
    {
      id: "staff",
      space_id: "s",
      name: "Staff",
      color: "#aabbcc",
      position: 1,
      is_default: false,
      mentionable: true,
      permissions: ["mention_everyone"],
    },
  ],
  memberships: [
    { user_id: "admin", role: "admin" },
    { user_id: "member", role: "member" },
  ],
  assignments: [{ space_id: "s", user_id: "member", role_id: "staff" }],
  overrides: [],
};
describe("role mention permissions", () => {
  it("matches override precedence: everyone deny, assigned role allow, administrator bypass", () => {
    const context: ServerRoleContext = {
      ...base,
      overrides: [
        {
          conversation_id: "c",
          role_id: "everyone",
          allow_permissions: [],
          deny_permissions: ["mention_everyone" as const],
        },
      ],
    };
    expect(canMassMention(context, "member", "c")).toBe(false);
    expect(canMassMention(context, "admin", "c")).toBe(true);
    context.overrides.push({
      conversation_id: "c",
      role_id: "staff",
      allow_permissions: ["mention_everyone"],
      deny_permissions: [],
    });
    expect(canMassMention(context, "member", "c")).toBe(true);
  });
  it("resolves only assigned custom roles and uses the highest role color", () => {
    expect(rolesForUser(base, "member").map((r) => r.name)).toEqual(["Staff"]);
    expect(rolesForUser(base, "other")).toEqual([]);
  });
});
