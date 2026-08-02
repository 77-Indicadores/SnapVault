# Security Policy

SnapVault is a self-hosted backup tool and may handle database dumps, object storage exports, access tokens, and destination credentials.

## Supported Versions

The project is currently in early MVP stage. Security fixes target the default branch.

## Reporting a Vulnerability

Please do not open public issues for sensitive vulnerabilities or leaked credentials.

If you find a security problem, report it privately to the maintainers of the CatConnect organization. Include:

- affected version or commit;
- impact;
- reproduction steps;
- relevant logs with secrets redacted.

## Operational Guidance

- Never commit `.env` files or production credentials.
- Use a strong `SNAPVAULT_SECRET_KEY`.
- Run SnapVault behind HTTPS in production.
- Restrict Microsoft Graph app permissions to the minimum required scope.
- Validate backup and restore policies before relying on them for critical workloads.
