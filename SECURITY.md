# Security policy

## Supported versions

Only the [latest release](https://github.com/Lokkisanek/Dash/releases/latest) gets security fixes. Please update before reporting.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

1. Preferred: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/Lokkisanek/Dash/security/advisories/new)). The report stays private between you and the maintainer.
2. If that is not possible: e-mail matoslav6@gmail.com.

Include the dash version, how you run it (hosted, self-hosted, Home Assistant version) and the steps to reproduce.

dash is maintained by one person. Replies are best effort; the aim is to acknowledge a report within a week and to agree on a fix and a disclosure date together.

## Design and threat model

What dash stores where, what the hosted instance can and cannot see, owner mode versus guest passes, and the known trade-offs are described in [docs/SECURITY.md](docs/SECURITY.md) and [docs/GUEST_PASSES.md](docs/GUEST_PASSES.md).
