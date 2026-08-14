// SLYK-0160: dispatcher↔slykboard contract version (07-dispatcher-contract.md
// § Versioning). Bump on breaking contract changes (field rename, required
// field added). The dispatcher checks this on boot and refuses to start on
// mismatch. Current value: 1.
export const SCHEMA_VERSION = 1;
