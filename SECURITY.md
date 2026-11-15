# Security

## Reporting a vulnerability

Please report it privately through GitHub's "Report a vulnerability" button on this
repository's Security tab, not in a public issue. Include what you did and what you
saw, with any real identifiers replaced by placeholders.

## What the connector can reach

The connector holds Google's per-file permission (`drive.file`) and nothing broader.
It can reach a file only if it created the file or the account holder picked it in
Google's file picker.

That permission includes the right to delete those files. The connector has no delete
tool and never calls Google's delete method, but this is a promise kept by the
server's code, not a limit Google enforces. Anyone who obtained a deployment's stored
access could delete the granted sheets, and only those. Each deployment therefore
keeps Google access encrypted under a key held as a Worker secret.

## Keeping private data out of this public repository

Nothing that identifies a person or a deployment is committed here: no credentials, no
account, project or client ids, no spreadsheet ids, no real hostnames, no email
addresses, no names, and no real logs or sheet contents. Examples use placeholders.
The rules a contributor or an agent follows are in `CLAUDE.md`.

## If something private is published by mistake

Deleting it from the repository does not unpublish it. Forks, clones, search engines
and GitHub's own caches may already hold a copy. So the order matters:

1. **If it is a credential, revoke or rotate it first**, in the service that issued
   it, before touching the repository. Treat it as stolen from the moment it was
   pushed, however quickly it is removed.
2. **Tell the owner what was exposed, where, and since when.** Do not push a commit
   that removes the value quietly; that leaves it in history and hides the incident.
3. **Remove it from history.** The owner rewrites the branch history to drop the value
   and force-pushes, or deletes the branch if it was never merged. A value in a PR
   description or comment is edited out and its edit history deleted.
4. **Ask GitHub Support to purge cached views and dangling commits**, because a
   rewritten commit stays reachable by its address until GitHub removes it.
5. **For personal data that cannot be rotated**, such as an email address or a
   spreadsheet id, do steps 2 to 4 and then reduce what the value is worth: change the
   sharing on the file, or accept that the value is public and note it.
6. **Write down what happened** in a decision record or the changelog, without
   repeating the value, and change the rule or check that let it through.
