# Security Policy

## Supported versions

Walcast is pre-1.0. Only the **latest 0.x release** of each package receives
security fixes — upgrade before reporting if you can.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
private vulnerability reporting instead:

**[Report a vulnerability](https://github.com/ManasMadan/walcast/security/advisories/new)**

Include what you can: affected package and version, a reproduction or proof of
concept, and your assessment of impact.

## What counts

Things I'd definitely want to hear about:

- The daemon's admin API or dashboard being reachable without the auth token.
  The daemon binds `127.0.0.1` by default and every admin route requires a
  bearer token — a bypass of either is a vulnerability. (Binding to a public
  interface is an explicit config choice; exposing the daemon that way and
  getting scanned is not a walcast bug, but a token-auth bypass on such a
  deployment is.)
- Flaws in the webhook HMAC signing/verification (`@walcast/sink-webhook`) —
  e.g. a way to forge `X-Walcast-Signature`, or a timing side channel in the
  verification helper.
- Credential leakage: database connection strings, auth tokens, or sink
  secrets ending up in logs, error messages, or API responses.
- Anything that lets one sink plugin read another sink's config or secrets.

SQL injection via your own walcast config, or vulnerabilities in third-party
community sinks, should go to the respective sink's repository.

## What to expect

This is a personal open-source project, not a company with a security team.
I'll respond on a best-effort basis — typically within a week — coordinate a
fix and disclosure with you, and credit you in the advisory unless you'd
rather stay anonymous.
