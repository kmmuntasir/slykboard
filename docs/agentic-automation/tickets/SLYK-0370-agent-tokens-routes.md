# SLYK-0370 — Agent token generate / revoke / list routes

**Phase:** 5 — Polish + Admin Tools
**Type:** Feature (backend)
**Depends on:** SLYK-0140, SLYK-0150

## Description

UI-managed dispatcher HMAC tokens (rotation path 2 from
`11-existing-patterns.md` § Dispatcher handshake). Admin router.

**Routes:**

1. **`POST /api/v1/admin/agent-tokens`** — body `{name: 1..200,
   projectId: uuid|null}`. Generate
   `crypto.randomBytes(32).toString('hex')`, store sha256 hash in
   `AgentTokens.tokenHash` + name + projectId + `createdBy = req.user.id`.
   Return the RAW TOKEN ONCE: `{token, id, name}` — never retrievable
   again (only the hash is stored).
2. **`DELETE /api/v1/admin/agent-tokens/:id`** — set `revokedAt = now()`
   (404 unknown id; 409 if already revoked), return 204.
3. **`GET /api/v1/admin/agent-tokens`** *(doc gap: list endpoint missing
   from `05` but required by the `/admin/tokens` page in `06`/`09`)* —
   return rows WITHOUT hashes: `[{id, name, projectId, createdBy,
   revokedAt, createdAt}]`. Hashes never leave the DB.

**Auth-chain note (dual token sources):** per `11` § Dispatcher handshake,
DB tokens are checked first with env token as fallback. Extend
`agentTokenAuth` (SLYK-0150) so inbound signature verification accepts
either the env token OR any non-revoked `AgentTokens` row (hash the raw
compare — verify signature attempt per candidate token; tokens are 64-hex,
candidate set is small). Cache token list in-process with short TTL (or
query per request — volume is low; start simple, note the seam).

## Acceptance criteria

- [ ] Generate: 64-hex token returned once; DB stores only sha256; raw
      not in any log.
- [ ] Inbound request signed with a DB-generated token passes
      `agentTokenAuth` (supertest round-trip: generate → sign → call
      internal endpoint → 200/501-not-401).
- [ ] Revoked token → inbound 401; env token still works.
- [ ] List returns no hash fields.
- [ ] Non-admin 403; unauth 401; plain 501.
- [ ] Duplicate name allowed (names aren't unique per schema) — documented
      behavior.

## References

- `docs/agentic-automation/05-backend-routes.md` § agent-tokens routes
- `docs/agentic-automation/04-schema.md` (AgentTokens)
- `docs/agentic-automation/11-existing-patterns.md` § Dispatcher handshake

## Dependencies

- SLYK-0140 (AgentTokens table)
- SLYK-0150 (agentTokenAuth to extend)
