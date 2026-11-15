# 0003: A sheet can be open to any chat, with no key

**Status:** proposed, 2026-11-15. Asked for by the owner; drafted and built by the agent
for the owner to accept.
**Reversible?** yes. It is a rule inside our own server.
**Revisit when:** sheets turn up under "Any chat" that the owner did not mean to put
there, or Claude lets a connector be switched on for one Project only.

## Context

`decisions/0002` made every tool call carry a project key and refused a call without
one. After using it, the owner found that too strict. Some sheets are meant for
ordinary chats outside any Project, and those chats have no instructions to hold a
key, so the connector was useless to them.

What success looks like: the owner can use the connector in an ordinary chat for
sheets they chose to open, and a sheet kept to a Project is still refused there.

## Facts this rests on (checked 2026-11-15)

| Fact | Consequence | Source |
|---|---|---|
| A chat outside any Claude Project has nowhere to keep a key. | Such a chat can only ever make calls with no key. | Claude's Projects, as used by the owner |
| The store that records where a sheet is can take up to a minute to show a change everywhere. | "No record" must not mean "open", or a sheet just created for a Project would be open to every chat for that minute. | Cloudflare's Workers KV documentation |

## Decision

1. Besides the groups, there is one more place a sheet can be: **Any chat**. A sheet
   there can be read and written by every chat on the account where the connector is
   switched on, with no key.
2. A call with no key reaches the Any chat sheets and nothing else. A sheet it creates
   goes to Any chat, and the answer says so.
3. A call with a valid key reaches that key's group and the Any chat sheets. A sheet it
   creates is kept to the group.
4. A call with a wrong key is refused outright. It does not fall back to Any chat. A
   Project whose key was replaced therefore fails loudly.
5. Any chat is recorded as an explicit marker on the sheet. A sheet with no record is
   reachable by nobody. Sheets that existed before this decision stay out of reach
   until the owner places them.
6. On the pick page and the manage page, Any chat is offered beside the groups and is
   never the first choice when a group exists.

This replaces point 3 of `decisions/0002`, which refused a request with no key.

## What I would push back on

- **A missing key no longer fails.** If a Project's instructions lose their key, or
  Claude leaves it out, a new sheet is created open to any chat instead of being
  refused. The answer to Claude says where the sheet went, and the manage page shows
  it, but nobody is stopped.
- **Any chat is the easy place to put things.** It needs no key and no setup, so
  sheets may collect there. Every sheet in it is exactly as exposed as with Claude's
  own account-wide connectors, though still far less than a whole Drive.
- **A Project is not confined to its group.** Every Project can also reach the Any
  chat sheets, with or without its key.

## Alternatives set aside

- **Treat every sheet with no group as open.** It is what was first asked for and it
  is simpler. It was set aside because of the second fact above: a sheet just created
  for a Project would be open to every chat until its record spread, and every sheet
  made before today would have become open without the owner choosing it.
- **A key for ordinary chats.** There is nowhere for an ordinary chat to keep one
  except memory, which is shared across chats and is where a key should never go.

## Consequences

- The connector works in ordinary chats again, for sheets the owner opened.
- The promise in `decisions/0002` narrows: a sheet kept to a Project stays out of
  reach of other chats, and a sheet open to any chat does not.
- Three places are shown on the manage page: each group, Any chat, and sheets not
  placed anywhere.
