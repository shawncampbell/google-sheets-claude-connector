# 0004: The connector keeps a catalog of its sheets, in a sheet

**Status:** proposed, 2026-11-15. Asked for by the owner; drafted and built by the agent
for the owner to accept.
**Reversible?** yes. Deleting the catalog sheet and the code that writes it loses
nothing but the notes typed into it.
**Revisit when:** the catalog is found out of date often enough to mislead, or the
owner wants more in it than the server can know.

## Context

The owner wanted one place in Google Sheets that lists every sheet the connector is
used for. They first got it by telling a Claude chat to create an inventory sheet and
keep it up to date. That depends on every chat remembering to do so, in every Project,
and a chat kept to one Project cannot see the others' sheets to list them.

What success looks like: the owner opens one sheet and sees every sheet the connector
can reach, where each one is, and what it is for, without having asked any chat to
maintain it.

## Decision

1. The connector itself keeps the catalog. It is one sheet in the owner's Drive,
   created only when the owner asks for it on the manage page.
2. It lists each reachable sheet's title, link, where it is (a group, Any chat, or not
   placed), when it was created and last changed, a note, and its id.
3. The connector rewrites it whole after a sheet is created, picked or moved, and when
   the owner presses the update button. Rewriting from what Google and the server know
   means it corrects itself, and a renamed or removed sheet is picked up on the next
   rewrite.
4. Notes are the one thing carried over between rewrites. They live in the sheet and
   nowhere on the server. The owner can type them, and Claude can supply a one-line
   purpose when it creates a sheet, which becomes that sheet's first note.
5. No chat can write to the catalog through the connector. A chat can read it only if
   the owner places it in a group or under Any chat. It starts out placed nowhere,
   because it names every Project's sheets in one place.
6. Values are written exactly as given, never as formulas, so a sheet whose title
   starts with "=" cannot run anything in the catalog.

## What I would push back on

- **It is only as fresh as the last change.** A sheet renamed in Google Sheets shows
  its old title until something triggers a rewrite or the owner presses the button.
- **Placing it somewhere undoes part of `decisions/0002`.** A Project that can read
  the catalog learns the titles of every other Project's sheets. The manage page says
  so beside the catalog.
- **A typed edit outside the Notes column is lost** on the next rewrite. The sheet
  says so in its first row.

## Alternatives set aside

- **Let Claude keep it, as the owner first did.** It needs no code, but it relies on
  every chat remembering, and no single chat can see every group.
- **Keep the notes on the server.** That would store the owner's own words about their
  sheets in the Worker's storage. Keeping them in the sheet stores them in the owner's
  Drive, where the rest of their data already is.
- **Update single rows instead of rewriting.** It would keep hand edits everywhere, but
  it drifts when a step is missed, and it has no way to notice a renamed or removed
  sheet.

## Consequences

- One more sheet in the owner's Drive, covered by the same per-file permission and the
  same delete limit as the rest.
- The connector uses two more Google calls, to empty a range and to write values
  exactly as given. They exist only for the catalog and are not offered to Claude.
- A catalog a chat made by hand is not adopted. The owner deletes or renames it.
