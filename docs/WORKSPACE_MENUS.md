# Workspace context menus and group invitations

Right-click a server, text/voice channel or DM/group row to open its menu.
The menu stays within the viewport, supports keyboard navigation and closes
on Escape, outside click, blur or resize. It uses the existing themed surface.
Submenus expose concrete actions only; server management is checked for the
target server, including when another server is selected.

Server actions include mark read, invite, mute/unmute channels, hide muted
channels, identity, management, channel/category creation, rail ordering,
leave and copy ID. Channel actions include read, mute, identity, copy link,
category assignment, management, deletion and copy ID. Destructive actions
require confirmation; ownership and server administration remain enforced
by the existing RPCs.

Group menus add pin, favorite, invite, identity, leave and copy ID. Pin/favorite,
rail order and hide-muted preferences are saved per account on this device,
matching the existing local notification preferences. A private DM offers a
separate new-group flow rather than adding strangers to the private thread.

The header, member list and group menu open the same invite dialog. Friends
can be selected or exact usernames entered, including people outside the friend
list. The dialog explains that joining gives access to shared group history.
`add_group_members` locks the conversation, checks active membership and group
kind, validates the entire batch and caps the group at 25 active members.
Repeated additions are idempotent. It requests envelopes for non-revoked devices;
the inviting client shares the existing key ring using the existing key delivery
mechanism. Members coming online later use the normal key-request flow.

Membership changes are delivered through the existing RLS rules and a Realtime
subscription. New groups and member counts update without reloading the app.
Leaving revokes future key-envelope delivery for that member, leaves messages
intact and transfers creator ownership to an active member if needed. As with
any shared encrypted history, previously downloaded data cannot be recalled.

Regression checks cover authenticated membership rules, unknown users, duplicate
invitations, the member limit, private-DM protection and leaving/rejoining. The
Electron integration check uses disposable users to verify context-menu bounds,
server category management, non-admin visibility, pinning, group discovery,
encrypted history, messages in both directions and leaving the group.
