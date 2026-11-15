# 0002: A project key keeps each Claude Project to its own sheets

**Status:** proposed, 2026-11-15. Drafted by the agent for the owner to accept. The
proof in `ROADMAP.md` tests it; accept it after the test, not before.
**Reversible?** yes. It is a rule inside our own server and can be replaced.
**Revisit when:** Claude tells a connector which Project a request comes from, or lets
a connector be switched on for one Project only.

## Context

The owner wants a sheet given to one Claude Project to stay out of reach of their
other chats, in a way that is enforced and does not depend on Claude choosing to
behave. Claude does not offer this. A connector is added to the whole account, any
chat can switch it on, and the server is not told which Project is calling. Whatever
separates Projects therefore has to be something the server can check on each request.

What success looks like: in a chat outside the Project, with the connector switched
on, Claude is asked to read the Project's sheet and the server refuses.

## Facts this rests on (checked 2026-11-15; re-check before relying on them)

| Fact | Consequence | Source |
|---|---|---|
| Each claude.ai Project has its own memory, kept apart from other Projects and from chats outside Projects. | Something Claude learned inside a Project is not offered to other chats through memory. | Claude help center, "Use Claude's chat search and memory", search summary 2026-11-15 |
| Claude's search of past chats stays inside one Project, or covers only chats outside Projects. | A key that appeared in a Project chat is not found by a search from elsewhere. | Same |
| A Project's instructions and knowledge are given to chats in that Project. | A key placed there is present in every chat in the Project. | Claude help center, "What are projects" |
| No source checked says outright that a Project's instructions are withheld from chats outside it. | The design rests on this. The proof must test it directly. | Gap found 2026-11-15 |

## Decision

1. The server keeps sheets in named groups. A sheet belongs to exactly one group.
2. Each group has a key the server generates. The owner sees it once, on a page served
   by the Worker, and pastes it into the instructions of the Claude Project that should
   use that group. The server stores only a hash of it.
3. Every tool call must carry a key. The server works only on sheets in that key's
   group and refuses everything else, including a request with no key.
4. A sheet created through a call joins the group of the key that call carried. On the
   picker page the owner chooses which group a picked sheet joins.
5. The key is not what protects the sheets from outsiders. A request must also come
   through the owner's signed-in connector, so a key that leaks is useless to anyone
   else. Its only job is to tell the owner's own Projects apart.
6. The owner can replace a group's key at any time, which cuts off every chat that
   holds the old one.

## What this does and does not enforce

It enforces that a chat without the key cannot reach the group's sheets, because the
refusal happens on the server and no wording in a chat can talk it round.

It does not protect a group from the Project that holds its key. Text inside a sheet
or a document could instruct Claude to misuse the sheets of that same Project, or to
print the key. It also depends on Claude keeping a Project's instructions inside that
Project, which is Claude's behaviour and outside our control. And the owner can defeat
it themselves by pasting a key into another chat.

## Alternatives set aside

- **Telling Claude in the Project instructions which sheet to use.** That is a request,
  not a limit. Another chat could use the sheet simply by naming it.
- **One connector address per Project.** Any chat can switch on any connector, so this
  separates nothing, and a Free plan allows only one custom connector.
- **Approving every tool call by hand.** Claude can ask before each call and the owner
  can refuse. It works, but it depends on the owner reading every prompt.

## Consequences

- Setting up a Project takes one more step: creating a group and pasting its key.
- The key is visible in the Project's instructions and in the details of each tool
  call. That is acceptable because of point 5, and the pages that show a key say so.
- If the proof shows Project instructions reach chats outside the Project, this
  decision is rejected and the limit falls back to approving calls by hand.
