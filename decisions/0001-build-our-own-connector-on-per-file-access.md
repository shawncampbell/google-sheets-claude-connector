# 0001: Build our own connector on Google's per-file permission, one deployment per person

**Status:** proposed, 2026-11-15. Drafted by the agent for the owner to accept.
**Reversible?** costly. The code is small, but a repository, a Cloudflare account and
a Google Cloud project are set up around this choice.
**Revisit when:** Google's own Sheets connector can be granted per-file access only,
or the proof in `ROADMAP.md` shows one of the facts below is wrong.

## Context

The owner wants a Claude Project to create a Google Sheet, read it and write to it,
without Claude being able to read anything else in their Google account and without
Claude being able to delete the sheet. The comparison they have in mind is how a phone
lets an app see selected photos instead of the whole library.

What success looks like: within two weeks the owner uses a Claude Project that keeps
its data in a sheet, and Google's own account page shows the connector holding per-file
access and nothing broader.

## Facts this rests on (checked 2026-11-15; re-check before relying on them)

| Fact | Consequence | Source |
|---|---|---|
| Google's `drive.file` permission covers only files the app created or the user picked in Google's file picker, and Google classes it as non-sensitive. | The "selected photos" model exists and needs no security assessment. | Google, "Choose Google Drive API scopes", read 2026-11-15 |
| The Sheets API lists `drive.file` as its recommended scope, described as "See, edit, create, and delete only the specific Google Drive files you use with this app". | Reading and writing cells should work with this permission alone. It also includes delete. | Google, "Choose Google Sheets API scopes", read 2026-11-15 |
| Google's hosted Drive and Sheets servers for AI agents require read access to all of Drive, and the Sheets one also requires read and write on all spreadsheets. Both are in a developer preview. | No existing connector is narrow enough, and the nearest one may change or be withdrawn. | Google, "Configure the Drive MCP server" and "Configure the Sheets MCP server", read 2026-11-15 |
| Claude's Google Drive connector is built and run by Google. | It carries the same broad read access. | Claude docs, "Google Drive", read 2026-11-15 |
| Claude accepts any remote server as a custom connector on every plan, and signs users in with OAuth. A Free plan allows one custom connector. | Our own server can be used from a chat Project. | Claude docs, "Add a connector that isn't in the directory" and "Authentication for connectors", read 2026-11-15 |
| Cloudflare publishes a Workers library that provides the sign-in a custom connector expects and encrypts the data attached to each signed-in user. | The server can be one small Worker, and Google access is not stored plain. | Cloudflare docs, "Authorization" under Model Context Protocol, read 2026-11-15 |
| A Google Cloud app left in "Testing" status has its sign-ins expire after 7 days. | Each deployment must be set to "In production" before real use. | Google, "Using OAuth 2.0 to Access Google APIs", read 2026-11-15 |
| A connector belongs to a Claude account, not to a Project, and the server is not told which Project a request comes from. | Keeping a sheet to one Project needs its own design: `decisions/0002`. | Claude docs, as above; not stated outright, inferred from how connectors are added and switched on |

Not yet checked by running it: that reading and writing work under `drive.file`
alone, that a picked sheet becomes reachable, that a custom connector behaves inside a
Project as it does in an ordinary chat, and that an app requesting only this
permission can be set to "In production" without Google's review.

## What I checked about my own judgment

The agent filled this in from the conversation; the owner should correct it.

- What I expected to find before I started: that the official connector demanded
  Drive, Gmail and Calendar together, and that nothing narrower existed.
- Where the evidence disagreed with that: Drive is connected on its own, and its write
  access is already per-file. The part that is too broad is read access to all of
  Drive.
- What would change my mind: the proof failing on any unchecked item above, or Google
  shipping per-file access in its own server before this is in use.
- What is pushing me toward an answer: the appeal of building something others could
  use. Two cheaper options were set aside partly for that reason, so they are recorded
  below with what they would have cost.

## Decision

1. Build a connector of our own: one Cloudflare Worker that speaks the Model Context
   Protocol and is added to Claude as a custom connector.
2. It asks Google for `drive.file` and no other Google permission.
3. It offers tools to create a sheet, read a sheet and write to a sheet. It has no
   tool that deletes, shares or moves a file, and it never calls those Google methods.
4. A page served by the Worker shows Google's file picker so the account holder can
   hand over an existing sheet.
5. Each person deploys their own copy with their own Google Cloud project. Signing in
   to the connector is signing in to Google, so the code already keeps each user's
   access separate, and a shared hosted version stays possible without a redesign. It
   is on the roadmap under Later and is not required for first use.
6. The answers `protocols/new-project.md` asks for, in the owner's protocols repo:
   - **Isolation unit:** one Cloudflare account that holds this Worker and its storage
     and nothing else, and one Google Cloud project that holds this app's OAuth client
     and nothing else.
   - **The one credential that reaches it:** the Workers Builds token, which lives in
     Cloudflare and never in GitHub.
   - **What it stores that is itself a credential:** each user's Google refresh token,
     encrypted under a key held as a Worker secret. The Google OAuth client secret is
     a Worker secret too.
   - **Deploy-sensitive files:** `wrangler.jsonc`, `package.json` scripts,
     `scripts/deploy.*`, anything under `.github/workflows/`, and `.devcontainer/*`.

## Changes made while building the proof (2026-11-15)

- **The sign-in also asks Google for `openid`.** The connector needs a stable way to
  tell one Google account from another, and `openid` supplies an opaque account id and
  nothing else: no email address, no name, no access to any data. Point 2 above
  therefore reads "`drive.file` and `openid`".
- **A deployment serves one Google account, the first to sign in.** Without this,
  anyone who found a deployment's address could sign in with their own Google account
  and use its quota. They could never reach the owner's sheets either way. A hosted
  version would replace this rule.
- **Cloudflare Access is not placed in front of the Worker.** The owner's standard for
  a deployed app is Access restricted to one email. Claude's servers call this Worker
  directly and cannot pass Access, so the Worker is public and protects itself with the
  Google sign-in. This is a recorded exception to that standard.

## Alternatives set aside

- **A second Google account that holds only shared sheets, used with the official
  connector.** It costs nothing to build and contains the exposure well. The owner
  judged a second account to be lasting overhead, and writing to a sheet shared into
  that account probably fails, because the official connector can write only to files
  it created.
- **Google's hosted Sheets server on that second account.** It gives create-by-hand,
  share, read and write with no delete. It depends on a developer preview that may
  change or end, and still needs the second account.
- **A service account that the owner shares one sheet with.** An editor cannot delete
  the owner's file, so the delete limit would be Google's and not ours. It cannot
  create sheets in the owner's Drive, and it does not extend to other users.
- **A broker such as an automation service.** The broker would hold a broad grant to
  the owner's Google account, which moves the problem instead of removing it.

## Consequences

- **"Cannot delete" is this server's promise, not Google's.** The permission includes
  delete. Stolen access could delete the granted sheets and no others. This is stated
  wherever a person or a model decides to rely on the connector; `CLAUDE.md` lists the
  places.
- The owner maintains a Worker, a Cloudflare account and a Google Cloud project.
- Handing over an existing sheet happens on a web page outside the Claude chat.
- A hosted version would mean holding other people's Google access and passing
  Google's app verification. That is a separate decision when it reaches Next.
- If Google adds per-file access to its own server, this project may become
  unnecessary. It is small enough that the loss would be modest.
