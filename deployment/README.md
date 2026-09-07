# Optional private deployment

Nothing in this directory has been deployed by the PR. `Dockerfile` builds/tests the source, then runs a non-root Node 22 image. `compose.yml` pairs one application process with Caddy TLS and named private volumes. Configure DNS and your own domain before starting. Review `SECURITY.md`; this is not an HA/SLA installation.

Bootstrap owner accounts locally without external credentials. Move the validated state **and vault.key** into the private application volume while no application is running; ensure the Node image user can read/write the volume. Disable public registration. Do not mount the private directory in multiple writers. Supply `deployment/.env` from `.env.example`, plus `AUREON_DOMAIN=your-domain`. Keep all real-money variables disabled during initial testing.

```sh
cd deployment
# Supply .env, bootstrap private state and verify DNS/TLS configuration first.
docker compose config
# The config output can contain secrets: do not publish it.
docker compose up --build -d
```

Docker and network/TLS provisioning require independent verification on the deployment host. Apply resource limits, log handling, monitoring, provider quotas, updates and backup schedules appropriate to that host. Rolling multiple JSON-store replicas is unsafe.

## Offline encrypted backup

Stop the server and verify it is no longer writing. Keep the passphrase outside command history/process arguments. The CLI reads it from `AUREON_BACKUP_PASSPHRASE`; do not put it in source.

```sh
export AUREON_OFFLINE_CONFIRM=SERVER_IS_STOPPED
# Set AUREON_BACKUP_PASSPHRASE securely: at least 16 characters.
node scripts/backup.mjs backup .aureon-data /private/backups/terminal.backup
node scripts/backup.mjs restore /private/backups/terminal.backup /private/restore/new-directory
```

Backups contain both state and MFA/VAPID key, encrypted with scrypt-derived AES-256-GCM. File creation is exclusive; restoring requires a new directory. The CLI confirmation is an operator assertion, not a cross-process locking protocol. Rehearse restore, permissions, audit verification, user sessions and provider-disabled startup before switching over. Never serve backups or `.aureon-data` as static files.
