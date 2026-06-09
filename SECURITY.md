# Security Policy

## Supported versions

mage is pre-1.0 and ships from a single line of development. Security fixes land
on the latest published `0.0.x` release.

| Version | Supported |
| ------- | --------- |
| latest `0.0.x` | yes |
| older releases | no — please upgrade |

## Reporting a vulnerability

**Please do not report security issues through public GitHub issues.**

Use GitHub's private vulnerability reporting:

- Go to the repository's **Security** tab and choose
  **[Report a vulnerability](https://github.com/Sumit1993/mage-memory/security/advisories/new)**.

If you cannot use that, email **sumitpatel.14may@gmail.com** with the details.

Please include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- The mage version and environment.
- Any suggested remediation, if you have one.

Do **not** include real secrets, tokens, or private content in your report.

## What to expect

- Acknowledgement within a few days.
- An assessment of severity and a fix plan for confirmed issues.
- Credit in the release notes if you would like it.

## Scope notes

mage is a file-based knowledge base that runs locally and is committed by a
human. It deliberately:

- never runs `git` on your behalf, and never auto-commits;
- redacts captured content through its Gate-1 / Gate-2 redaction before anything
  is written to tracked files;
- captures insight, procedure, and pointers — never copies of source material.

Reports that strengthen those guarantees (for example, a redaction bypass or a
path-traversal in a write path) are especially valuable.
