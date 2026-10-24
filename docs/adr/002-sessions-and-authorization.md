# ADR-002: revocable sessions and scoped authorization

Status: proposed baseline. Date: 24 October 2026.

## Decision

Use short-lived signed access credentials and rotated opaque refresh tokens whose hashes/session records are stored server-side. Use secure HttpOnly cookies on controlled app/API domains with exact Origin/CORS rules and CSRF defenses. Refresh reuse revokes the token family; logout/revoke-all and account suspension invalidate sessions. Define lifetimes/configuration during identity implementation.

Role grants come from Auth; active workspace selects an existing grant. Domain owners enforce ownership, seller membership, rider assignment, verification state and fine-grained admin permissions. A verified JWT alone cannot bypass a current suspension; sensitive commands check revocation/current grant state, and caches have bounded TTL and invalidation.

Socket access uses a short-lived one-use ticket in the auth payload. Recheck session/room entitlement on join and reconnect; disconnect/revoke rooms when grants or assignment change. Admin MFA is mandatory; service identities are audience-scoped and distinct from user credentials.

## Tradeoffs

Cookies simplify browser credential handling but require deliberate domain, SameSite and CSRF design. Default hosting domains may be cross-site. Do not use permissive CORS or frontend localStorage refresh tokens as a shortcut. Nonbrowser/native clients require a separately documented secure credential transport.

## Validation

Cross-role/object tests, session-family reuse, logout, cookie/CSRF configuration, safe returnTo handling, admin step-up and socket ticket replay tests are identity/realtime exit criteria. Public registration cannot request admin privileges.
