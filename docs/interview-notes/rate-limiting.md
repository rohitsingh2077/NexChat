# Rate limiting

Phase: cross-cutting hardening pass (see git log around this file's introduction).

## Problem

Nothing in NexChat capped how fast one client could call an endpoint. `channel-messaging.md`
flagged this explicitly as a deferred gap when channel messaging shipped. The concrete risks:
brute-forcing `/api/auth/login`, registration spam, friend-request spam, and (once servers
existed) spinning up unlimited servers or hammering `send_message` from one socket.

## Naive approaches, and why they fail

**"Add `express-rate-limit`."** Reasonable in a lot of apps, but it only covers HTTP routes -
`send_message` is a Socket.IO event with no middleware chain to attach it to. Pulling in a
library for half the problem and hand-rolling the other half is worse than one small
hand-rolled primitive that works for both (see rule 6 - avoid a dependency when a few lines do
the job clearly).

**"Redis-backed rate limiting."** The standard answer once you have multiple backend
instances sharing counters. NexChat runs as a single Node process (same reasoning as the
`userSocketMap` presence store) - a shared store would solve a scaling problem this app
doesn't have yet, at the cost of a Redis round-trip on every limited call.

## Our solution

`backend/middleware/rateLimit.js`: a hand-rolled in-memory fixed-window counter.

```
checkAndConsume(key, windowMs, max) -> bool   // core primitive, transport-agnostic
rateLimit({ name, windowMs, max, keyFn })     // Express middleware wrapper
byIp(req) / byUser(req)                       // the two identities we limit by
```

`key` is `${name}:${identity}` - the `name` namespaces each limiter's bucket so two limiters
keyed on the same user (e.g. DM-send and server-creation) don't share one counter. A periodic
sweep (every 10 minutes, `unref()`'d so it doesn't keep the process alive) evicts stale
buckets so one-off keys don't leak memory forever.

Because `checkAndConsume` doesn't know about Express, it's usable directly from a socket
handler too - `channelHandler.js`'s `send_message` calls it inline instead of going through
the middleware wrapper.

### Fixed-window, not sliding-window or token-bucket

Fixed-window ("at most N calls in this window-wide block of time") is the simplest correct
algorithm. Its known edge case - a client saves up requests to the last moment of one window,
then bursts again at the start of the next, letting through up to ~2x the nominal rate over a
short span - is a precision problem, not a security hole; the *sustained* rate stays bounded.
A sliding-window log or token-bucket algorithm closes that edge case but adds real complexity
(a sorted timestamp list, or a replenishment-rate calculation) this app's threat model doesn't
justify (rule 4 - do not overengineer).

### Where limiters are applied

| Limiter | Key | Window / max | Why this identity |
|---|---|---|---|
| `login` | IP | 15 min / 10 | Pre-auth - no `req.user` yet to key on |
| `register` | IP | 15 min / 10 | Same - separate bucket from `login` so a tripped login limiter doesn't block registration |
| `send-friend-request` | user | 60 s / 20 | Authenticated - caps one account spamming friend requests |
| `create-server` | user | 10 min / 10 | Caps spam server-creation |
| DM `message:send` | user | 10 s / 20 | Caps one account flooding DMs |
| channel `send_message` (socket) | user | 10 s / 20 | Same cap, socket transport - see channel-messaging.md's "authorization must be re-checked, not inferred" principle: rate limiting gets the same treatment, checked on every event, not once at connect |

IP-keyed limiters run before authentication is possible; user-keyed limiters always run after
the auth middleware that populates `req.user`, since `byUser` needs `req.user._id`.

## Failure cases

| Scenario | Behavior |
|---|---|
| Two requests from the same user arrive in the same tick, both check the bucket before either increments | Node is single-threaded per event-loop tick; `checkAndConsume` reads and writes the `Map` entry synchronously within one call, so there's no window for two concurrent requests to both observe "under the limit" and both pass - unlike a naive read-then-write against an external store, no race is possible here |
| Backend process restarts | All buckets are lost - every client's limit resets. Accepted: a restart is rare, and a client isn't worse off than before the limiter existed |
| A legitimate user is IP-limited alongside an attacker sharing the same IP (NAT, campus wifi) | Accepted trade-off of IP-keyed limiting - flagged, not solved; per-account limiting is used everywhere identity is available (i.e. everywhere except pre-auth) |

## What we deliberately did not do

- **No distributed/Redis-backed limiter.** Would only matter with multiple backend instances -
  see rule 9. Revisit if this app is ever horizontally scaled.
- **No sliding-window or token-bucket algorithm.** Flagged above - fixed-window's imprecision
  at window boundaries is an accepted trade-off, not an oversight.
- **No global "requests per IP across all routes" cap.** Each limiter is scoped to one action
  (`name`), not a blanket cap - a user hitting their DM-send limit shouldn't also be blocked
  from, say, leaving a server.

## Common interview questions

**Q: Why is the rate limiter usable from both Express middleware and a raw socket handler?**
The actual algorithm (`checkAndConsume`) doesn't reference `req`/`res` at all - it's a pure
function over `(key, windowMs, max)`. `rateLimit(...)` is a thin Express-shaped wrapper around
it. Keeping the primitive transport-agnostic meant `channelHandler.js` could reuse the exact
same counter logic without needing a fake middleware chain for socket events.

**Q: What happens right at a fixed window's boundary?** A client could send `max` requests in
the last millisecond of one window and another `max` in the first millisecond of the next,
briefly exceeding the nominal rate by up to 2x. This is the well-known fixed-window edge case -
accepted here because the *sustained* rate is still capped, and the fix (sliding-window log)
isn't worth the added complexity for this app's threat model.

**Q: Why separate `login` and `register` limiters instead of one shared "pre-auth" limiter?**
Namespacing (`name`) keeps them as independent buckets on purpose - a user who mistypes their
password 10 times and trips the login limiter shouldn't also be blocked from registering a new
account from the same IP. Same reasoning as keying DM-send and server-creation separately for
an authenticated user.
