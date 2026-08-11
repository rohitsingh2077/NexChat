const AppError = require("../utils/AppError");

// In-memory fixed-window rate limiter - hand-rolled rather than a library,
// since the algorithm is simple enough to implement (and explain) directly
// rather than hide behind a dependency. See LEARNING NOTES.
const buckets = new Map(); // key -> { count, windowStart }

// Periodic sweep so `buckets` doesn't grow unbounded with one-off keys (an
// IP/user that only ever makes a single request never gets cleaned up
// otherwise). Runs far less often than any realistic window, so it's cheap.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart > SWEEP_INTERVAL_MS) buckets.delete(key);
  }
}, SWEEP_INTERVAL_MS).unref();

// Core primitive, usable outside Express (e.g. socket event handlers, which
// have no middleware chain to hook into). Returns true if this call is
// allowed, false if the caller has exceeded `max` calls within `windowMs`.
const checkAndConsume = (key, windowMs, max) => {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  entry.count += 1;
  return entry.count <= max;
};

// Express middleware wrapper around checkAndConsume. keyFn identifies who's
// being limited - byIp for routes with no authenticated user yet (register/
// login), byUser for everything else. `name` namespaces this limiter's
// bucket so two different limiters keyed on the same identity (e.g. a
// user's DM-send limit and their server-creation limit both use byUser)
// don't collide into one shared counter - without it, sending a DM would
// silently eat into a completely unrelated action's quota.
const rateLimit = ({ name, windowMs, max, keyFn, message = "Too many requests, please slow down." }) =>
  (req, res, next) => {
    if (checkAndConsume(`${name}:${keyFn(req)}`, windowMs, max)) return next();
    next(new AppError(429, message));
  };

const byIp = (req) => req.ip;
const byUser = (req) => String(req.user._id);

module.exports = { rateLimit, checkAndConsume, byIp, byUser };

/*
============================================================
LEARNING NOTES
============================================================

PURPOSE:
Prevents a single client (by IP pre-auth, by userId once authenticated)
from calling an endpoint or socket event faster than a fixed cap - brute
force login attempts, registration spam, friend-request spam, message
flooding.

WHY FIXED-WINDOW, NOT SLIDING-WINDOW OR TOKEN BUCKET:
Fixed-window ("at most N calls in this windowMs-wide block of time") is the
simplest correct algorithm and is enough for this project's threat model -
it has a well-known edge case (a burst right at the window boundary can let
through up to ~2x the nominal rate: a client that saves up requests until
the last moment of one window, then bursts again at the start of the next),
but that's a precision problem, not a security hole - the sustained rate is
still bounded. A sliding-window log or token-bucket algorithm closes that
edge case but adds real complexity (a sorted timestamp list, or a
replenishment-rate calculation) that isn't justified by this app's actual
risk profile.

WHY IN-MEMORY, NOT REDIS:
This app runs as a single Node process. An in-memory Map is the entire
correct answer for one process - Redis-backed rate limiting only becomes
necessary once there's more than one backend instance and counters need to
be shared across them, which isn't this project's situation (see rule 9 in
this repo's engineering rules: don't add infrastructure ahead of a real
need). If the backend is ever horizontally scaled, this is the first thing
that needs to move to a shared store, alongside the presence map in
realtime/socket.js.

WHY A HAND-ROLLED MIDDLEWARE INSTEAD OF express-rate-limit:
The entire algorithm is the ~10 lines in checkAndConsume - reaching for a
dependency to do something this small would hide the one interesting part
(the windowing logic) behind a library, which cuts against being able to
explain what the code does line by line.

FAILURE CASES:
- Process restarts -> all counters reset (everyone's window starts fresh).
  Acceptable: a restart is rare, and worst case someone gets a few extra
  requests in immediately after, not a security bypass.
- Two users behind the same IP (shared NAT/office network) hitting an
  IP-keyed route (register/login) share a bucket - a false positive that
  rate-limits an innocent second user too early. Accepted trade-off for
  routes with no authenticated identity to key on yet.

INTERVIEW CONCEPTS:
- fixed-window vs sliding-window vs token-bucket rate limiting, and the
  burst-at-boundary trade-off fixed-window makes
- why rate limiting keyed by IP vs by authenticated user id are different
  tools for different trust levels
- why this specific piece of shared mutable state (buckets, like
  userSocketMap elsewhere) doesn't survive horizontal scaling without a
  shared store
============================================================
*/
