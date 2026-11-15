# google-sheets-claude-connector: working notes for Claude

This repo builds a connector that lets Claude create, read and write Google Sheets
while holding access only to the sheets its owner chose. What it is for is in
`PROJECT.md`; why it is built this way is in `decisions/`.

## This repository is public

Everything committed here, every commit message, every PR description and every
comment is readable by anyone, and stays readable in forks and caches after it is
deleted. Rules for any session working here:

- Never write a credential value, an account id, a Google Cloud project id or number,
  an OAuth client id, a spreadsheet id, a hostname with a real subdomain, an email
  address, or the name of a person, employer or client. Where an example needs a
  value, use an obvious placeholder such as `YOUR_CLIENT_ID` or `example.com`.
- Never paste real tool output, logs, screenshots or sheet contents into a file, a
  commit message or a PR. Describe what was seen, or replace every real value first.
- Before every commit, read the staged diff for the items above. Before every push,
  read the commit messages too.
- If something private is committed or pushed, stop and tell the owner at once, then
  follow `SECURITY.md`. Do not try to hide it with a further commit.
- Instance settings live in the Cloudflare dashboard and in `.dev.vars`, which is
  ignored by git. Nothing that identifies one deployment belongs in the repo.
- One exception is accepted by the owner (2026-11-15): the tool that opens pull
  requests adds a footer linking to the Claude session that wrote them. The link opens
  only for the owner and holds nothing private. Leave it in place, and do not add
  session links anywhere else.

## The delete limit must be stated wherever someone relies on it

Google's per-file permission includes the right to delete the files it covers. This
connector has no delete tool, so Claude cannot ask for a deletion, but that is a
promise kept by this server's code and not a limit Google enforces. Say so, in plain
words, in each of these places, and keep them in step when one changes: the README,
`SECURITY.md`, the install runbook, the page a person sees before granting access, the
page where they pick a sheet, and the description of each tool that writes. A PR that
adds a new place where a person or a model decides to trust the connector adds the
statement there too.

## Conventions every project repo carries

This section is copied from `conventions.md` in the owner's protocols repo, which is
the source. When that file changes, update this section to match. It was written for
private repos on GitHub Free, where the first five lines cannot be enforced. This repo
is public, so GitHub can enforce some of them; the lines hold either way.

1. **The agent never pushes to `main` or the production branch.** All work goes
   through a PR the owner merges. The merge is the deploy gate.
2. **Deploy-sensitive files change only in their own small PR, titled as such, never
   inside a feature PR**: `wrangler.jsonc`, `scripts/deploy.*`, `package.json`
   scripts, anything under `.github/workflows/`, `.devcontainer/*`, and any Workers
   Builds setting (the PR body lists the dashboard changes the owner must make).
3. **The agent never handles credentials.** Cloud tokens, Access, database and
   namespace provisioning, and Worker secrets are the owner's.
4. **No credential is stored in a database or KV namespace in plaintext.** Anything
   that must be stored is encrypted under a key held as a Worker secret.
5. **The agent counts as a second contributor.** Any rule written as "overkill until a
   second contributor" is in force.
6. **The agent keeps `ROADMAP.md` and `CHANGELOG.md` current inside every feature
   PR** (a Now line when it opens a draft PR, a line under Unreleased when the work
   ships) and never reorders Next or Later on its own; it proposes changes to them in
   the PR description. The files and their habits: `protocols/product.md`.
7. **In a decision that is hard to undo, the agent's default is to gather the
   evidence, say what it would push back on, and draft the record for the owner to
   accept.** Asked for its view, it gives one plainly, with the case against. Told to
   skip ahead, it says once what that costs and goes along. One method for this is
   `protocols/area-method.md`; it is not the only one.
8. **Every PR description has a `## How to try it` section**, with the heading
   written exactly so, because tools may read it from merged pull requests. It gives
   one to three numbered steps the owner can follow in the running app, ending with
   what they should see. A change with nothing to try says "Nothing to try:" and why.
   The PR template carries the section; this line holds even when a PR is opened
   without the template. The reason is in `protocols/product.md`, under Definition of
   Done.

### How the agent writes to the owner

Write for a human reading one line at a time, not for a model that takes
in the whole text at once. Tell the story: what you'd do, what I'd see,
why it matters, in that order. Every sentence must convey something on
its own; if a reader has to decode a phrase before it means anything,
rewrite it. No coined labels or shorthand for ideas ("the spine",
"bundle out, proposals in"); say the thing. No clipped fragments as
sentences. Lead with the recommendation and the reason, not with
caveats or with how the request relates to existing guidance. Use
headers and lists only when they help a reader skim, never to compress.
