# 0005: Claude can change anything inside a spreadsheet; only the file itself is off limits

**Status:** proposed, 2026-11-15. The owner set the rule in point 4; the rest was
drafted and built by the agent for the owner to accept.
**Reversible?** yes. The list of allowed changes is one file.
**Revisit when:** a change on the list turns out to reach outside the spreadsheet, or
version history proves not to be enough to recover from a mistake.

## Context

The first tools dealt only with cell values. On the first real use the owner asked for
a dropdown and a new tab, and Claude could do neither. It also pointed the owner to
Google's own Sheets connector as a workaround, which holds read and write access to
every spreadsheet in the account, the very grant this project exists to avoid.

Google offers every change inside a spreadsheet through one method that takes a list
of requests. That method also removes tabs, rows and columns.

The agent's first draft passed on structural changes but refused to remove a tab,
rows, a range or duplicate rows, or to rename the file. The owner rejected that as
fake security. Claude could already overwrite every cell, and find-and-replace or a
sort can spoil a sheet as thoroughly as removing rows. Refusing removals protected
nothing and made ordinary requests fail.

What success looks like: Claude sets up and maintains a working sheet, including
tidying it, without the owner doing any of it by hand or reaching for a broader
connector.

## Decision

1. One tool, `change_structure`, passes requests to that Google method. Claude writes
   them in Google's own form, which it already knows well.
2. Each request is passed on only if its name is on a list kept in `src/structure.ts`.
   One refused request stops the whole call, so nothing is half done.
3. The list covers tabs, rows and columns, merging, formatting, dropdowns and other
   validation, conditional formatting, filters, named and protected ranges, charts,
   and the file's title, locale and time zone.
4. **Removing is allowed**: a tab, rows or columns, a range, duplicate rows. The line
   this project holds is the file. Claude cannot delete, share or move a spreadsheet
   file, and nothing on the list can. While the file exists, Google's version history
   holds what was removed.
5. The tool obeys the same limits as the others: the project key's reach, and no
   writing to the catalog.

## What the list is for, now that it does not stop removals

It keeps out kinds of request nobody has looked at. A name Google adds later is
refused until someone adds it on purpose, and requests that connect a sheet to outside
data are not on it.

## What I would push back on

- **Version history is the only undo.** It is Google's feature and outside this
  connector's control. A removal the owner does not notice for a long time may be
  awkward to recover, and a deleted tab's history is reached through the file's
  history, not the tab's.
- **Claude is asked, not forced, to check before removing data.** The tool's
  description tells it to say what will be removed and make sure the user asked. That
  is a request to Claude, not a limit.

## Alternatives set aside

- **Refuse removals**, as first drafted. Set aside by the owner for the reason above.
- **A separate tool for each change.** It would take dozens of tools to cover what
  people ask for, and each gap sends the owner back to a broader connector.
- **Pass every request through with no list.** A new kind of request from Google
  would then be allowed without anyone looking at it.

## Consequences

- The connector's promise is now stated as "cannot delete a spreadsheet file", with
  changes inside a file, removals included, said to be possible and undoable from
  version history. The pages, tool descriptions, README and runbook use that wording.
- "Cannot delete" remains this server's promise and not Google's.
