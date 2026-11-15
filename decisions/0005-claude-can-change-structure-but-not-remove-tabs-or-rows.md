# 0005: Claude can change a sheet's structure and formatting, but not remove tabs or rows

**Status:** proposed, 2026-11-15. Prompted by the owner's first real use; drafted and
built by the agent for the owner to accept.
**Reversible?** yes. The list of allowed changes is one file.
**Revisit when:** the owner finds they often have to remove rows or tabs by hand, or a
change on the list turns out to do more than expected.

## Context

The first tools dealt only with cell values. On the first real use the owner asked for
a dropdown and a new tab, and Claude could do neither. It also pointed the owner to
Google's own Sheets connector as a workaround, which holds read and write access to
every spreadsheet in the account, the very grant this project exists to avoid.

Google offers every structural change through one method that takes a list of
requests. That method also removes tabs, rows and columns, and renames the file.

What success looks like: Claude sets up a working sheet, with tabs, dropdowns,
formatting and frozen headers, without the owner doing any of it by hand or reaching
for a broader connector.

## Decision

1. One new tool, `change_structure`, passes requests to that Google method. Claude
   writes them in Google's own form, which it already knows well.
2. Each request is passed on only if its name is on a list kept in `src/structure.ts`.
   A name not on the list is refused, including any name Google adds later. One
   refused request stops the whole call, so nothing is half done.
3. The list covers adding and renaming tabs, inserting and sizing rows and columns,
   merging, formatting, dropdowns and other validation, conditional formatting,
   filters, named and protected ranges, and charts.
4. Five kinds of request are left out on purpose: removing a tab, removing rows or
   columns, removing a range, removing duplicate rows, and changing the file's own
   properties such as its title. Claude is told to send the owner to Google Sheets for
   those.
5. The tool obeys the same limits as the others: the project key's reach, and no
   writing to the catalog.

## What I would push back on

- **Some allowed changes can still destroy contents.** Find-and-replace, cut-and-paste,
  sorting and overwriting cells can all wreck data. That was already true of writing
  cells. Google's version history undoes it; this connector does not.
- **Leaving out row removal will be felt.** "Delete row 5" is an ordinary request, and
  Claude will have to decline it or blank the row instead. I left it out because the
  owner's first rule for this project was that Claude should not delete, and widening
  that should be their choice. Adding it later is one line.
- **Removing a chart, a filter or a formatting rule is allowed.** Those remove
  something Claude or the owner set up, but no cell data.

## Alternatives set aside

- **A separate tool for each change**, such as "add a tab" and "set a dropdown". It
  reads more plainly, but it would take dozens of tools to cover what people ask for,
  and each gap sends the owner back to a broader connector.
- **Pass every request through.** That would let Claude remove tabs and rows and rename
  the file, against what the code and README promise.
- **Refuse a list of known-bad names and allow the rest.** A new kind of request from
  Google would then be allowed without anyone looking at it.

## Consequences

- The connector's own statement changes from "no tool removes a tab" to "no tool
  removes a tab, rows or columns", and the README says what Claude can now do.
- The tool's description is long, because it has to teach the form of a request.
- "Cannot delete" is still this server's promise and not Google's, now for tabs and
  rows as well as for the file.
