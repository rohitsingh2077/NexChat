# Server RBAC: roles, membership, and authorization

Phase: servers & channels backend (see git log around this file's introduction for the commit).

## Problem

DMs only ever involve two people, so `messageController.sendMessage` could authorize
with a single check (are these two users friends, per `messagePrivacy`). Servers
introduce a group with a real hierarchy: some members should be able to create or
delete channels, most shouldn't. That needs a persisted role per (user, server) pair
and a check that runs on essentially every server-scoped request.

## Naive approaches, and why they fail

**"Store an `admins: [userId]` array on the Server doc."** Works for exactly one
privileged tier. The moment you need a third tier (owner vs admin vs member, which
this app needs immediately - only an owner can transfer ownership, only owner/admin
can manage channels), you're maintaining parallel arrays that can drift out of sync
with each other.

**"Check `server.ownerId === req.user._id` for everything."** Only answers "is this
the owner," not "is this user a member at all" or "what's their role" - and doesn't
scale past a single privileged tier.

**"Embed a `members: [{userId, role}]` array on Server."** The read pattern that
matters most - "is this one user a member, and what's their role" - runs on nearly
every request. An embedded array means loading the whole array and scanning it in
application code every time, instead of one indexed document lookup.

## Our solution

### 1. `ServerMembership` - role lives in its own collection

`backend/modules/servers/serverMembership.model.js`: one document per
(serverId, userId) pair, holding `role: 'owner' | 'admin' | 'member'`. A unique
compound index on `{serverId, userId}` is both the "can't join twice" constraint
and the exact shape of the authorization lookup - see the model's own LEARNING NOTES
for why this is a join table, not an embedded array.

### 2. Authorization as two composable middlewares

`backend/modules/servers/server.middleware.js`:

```
isServerMember   -> loads ServerMembership for {serverId, userId}, 403s if absent,
                     attaches req.membership
requireRole(list) -> 403s unless req.membership.role is in list; must run after
                     isServerMember
```

Route wiring makes the intent readable at a glance:

```js
router.post("/", validateCreateChannel, requireRole(["owner", "admin"]), createChannel);
router.get("/", listChannels); // any member
```

Channel routes are mounted under `/:serverId/channels` behind `isServerMember` at the
mount point in `server.routes.js`, so every channel handler can assume
`req.membership` already exists - membership is checked once per request, not
per-route.

### 3. Identity, never trusted from the client

Exactly like `isLogin` for the rest of the app: `req.user._id` comes from the
verified JWT cookie. `isServerMember` looks up membership by that id, not by
anything the client could pass in the request body. A client cannot claim to be a
different member or a different role.

## Data flow

```
POST /api/servers/:serverId/channels
  -> isLogin (existing): req.user from verified jwt
  -> validateObjectIdParam("serverId"): reject malformed ids before any query
  -> isServerMember: ServerMembership.findOne({serverId, userId: req.user._id})
       -> not found: 403 NOT_A_SERVER_MEMBER (server's existence isn't
          confirmed or denied to a non-member - see middleware comment)
       -> found: req.membership = { role, ... }
  -> requireRole(["owner","admin"]): 403 INSUFFICIENT_SERVER_ROLE unless role matches
  -> controller/service: Channel.create({serverId, name})
```

## Failure cases

| Scenario | Behavior |
|---|---|
| Two join requests for the same user race each other | Unique index lets exactly one insert win; the other gets a duplicate-key error, caught and turned into `{alreadyMember: true}` instead of a 500 |
| Non-member requests a server that doesn't exist | Same 403 as a non-member requesting a server that *does* exist - doesn't leak which case it is |
| Owner tries to leave | Rejected with `400 OWNER_CANNOT_LEAVE` rather than silently orphaning the server - ownership transfer isn't built yet, so this is an explicit, deliberate gap, not a bug |
| Member's role changes while they have server-scoped requests in flight | Each request re-reads `ServerMembership` fresh via `isServerMember` - no cached/stale role, so a demoted admin's next request is authorized against their new role, not whatever they had a moment ago |

## Update: approval-gated joining, kicking, and promotion (later addition)

The initial version only had open joining and no way to remove or promote a member. Three
additions since, all built on the same `ServerMembership`/`isServerMember`/`requireRole`
primitives above - no new authorization concept, just new call sites.

### `joinPolicy: 'open' | 'approval_required'`

A field on `Server`, checked once inside `server.service.js`'s `joinServer`. `'open'`
(default) is the original behavior - `joinServer` creates a `ServerMembership` immediately.
`'approval_required'` creates a `ServerJoinRequest` instead (`backend/modules/servers/
serverJoinRequest.model.js`) - a pending-request document, same "existence *is* the state"
convention as `friendRequestModel.js`: no `status` field, approve creates the membership and
deletes the request, reject just deletes it. A unique compound index on `{serverId, userId}`
makes a second `joinServer` call while one is already pending idempotent (duplicate-key ->
re-read and return the existing pending request), the identical pattern used everywhere else
in this codebase that has a "no duplicates" constraint (`ServerMembership`, `friendRequestModel`).

`listJoinRequests`/`approveJoinRequest`/`rejectJoinRequest` are owner/admin-only
(`requireRole(["owner", "admin"])`), same as channel management - nothing new to authorize,
just another admin action gated behind the existing role check.

### `kickMember` vs `leaveServer`

Two different code paths for "membership ends," on purpose. `leaveServer` is self-service (no
role check needed - anyone can remove their own membership, except the owner, which is
rejected outright per the ownership-transfer gap below). `kickMember` is someone else acting
on a member, so it's gated by `requireRole(["owner", "admin"])` at the route, and the service
layer additionally rejects `role === 'owner'` as a target - an admin (or a compromised admin
session) can't kick the owner via this path.

### `updateMemberRole` is owner-only, not `requireRole(["owner","admin"])`

The one place role-checking is *stricter* than the channel-management pattern. Route wiring:

```js
router.patch("/:serverId/members/:userId/role", isServerMember, requireRole(["owner"]), ...);
```

If admins could promote/demote other admins, an admin could promote an ally to admin (or demote
a rival admin) with no owner involved - a privilege-escalation path with only peer-level
authorization behind it. Restricting role changes to the owner keeps "who has admin" under a
single point of control. `ADJUSTABLE_ROLES = ['member', 'admin']` in `server.service.js` also
blocks granting/revoking `'owner'` through this endpoint at all - ownership only ever originates
in `createServer`, never reassigned via a role-update call (see "no ownership transfer" below).

## What we deliberately did not do

- **No per-channel permission overwrites.** Roles are server-wide (an admin is an
  admin in every channel of that server), not Discord's per-channel permission
  matrix. A deliberate scope choice for the first version - see
  `docs/interview-notes/` conversation history for the trade-off discussion.
  (`allowedChannelIds` on `ServerMembership`, added alongside approval-gated joining, is a
  narrower mechanism than this - it restricts *which channels an approved member can see at
  all*, set once at approval time, not a per-channel role/permission matrix.)
- **No invite codes.** `joinPolicy: 'approval_required'` gates joining behind owner/admin
  approval, but there is still no shareable invite-code/link mechanism - a user still needs the
  `serverId` itself to request to join. Invite codes remain a clearly separable later addition.
- **No ownership transfer.** An owner is permanent for now; leaving is blocked
  rather than handled.

## Common interview questions

**Q: Why is role stored on a join document instead of on the User or the Server?**
Role is a property of the *relationship* between a user and a server, not of either
one alone - the same user can be an owner of one server and a plain member of
another. A join collection is the natural place for state that only makes sense in
the context of a specific pair.

**Q: Why does `isServerMember` return 403 instead of 404 for a server that doesn't
exist?** To avoid leaking whether a given `serverId` corresponds to a real server to
someone who isn't a member of it - both "wrong id" and "real server, not your
membership" look identical from the outside.

**Q: How do you keep two different route files (`server.routes.js`,
`channel.routes.js`) from each re-implementing the membership check?**
`server.routes.js` mounts the channel router with `isServerMember` as part of the
mount chain (`router.use("/:serverId/channels", validateObjectIdParam(...), isServerMember, channelRouter)`),
so the check runs once before any channel handler is reached, and channel handlers
never have to know how membership is verified - they just trust `req.membership`.
