# google-sheets-claude-connector

This page is a first draft written by the agent for the owner to correct. It becomes
the one-pager when the owner merges it.

## Problem

Someone who wants a Claude Project to keep its working data in a Google Sheet has to
connect a Google connector that can read every file in their Drive. They want Claude
to reach one sheet, and granting the whole Drive to get that is more than they are
willing to give. Today they either accept the broad grant, keep a second Google
account that holds only the shared sheets, or copy data in and out of the chat by
hand.

## Target user

One person who uses Claude Projects for their own work, is comfortable deploying a
Cloudflare Worker from a runbook, and will not grant an assistant their whole Drive.

## Success metric

The owner runs a Claude Project that creates and updates its own sheet for a month,
and at no point in that month can Claude read or change any Google file the owner did
not hand to it.

## Non-goals

- Deleting sheets, sharing them, or changing who can see them.
- Google Docs, Slides, Gmail or Calendar.
- Reading a sheet the owner has not picked, even if a link to it is pasted in chat.
- A hosted service that holds other people's Google access. It is on the roadmap as a
  later step and is not needed for the project to be useful.

## Appetite

Two weeks to a proof the owner uses in a real Project, then reconsider.

## Riskiest assumption

That a sheet granted to one Claude Project can be kept out of reach of the owner's
other chats. Claude gives a connector no way to know which Project is calling, so
this depends on the design in `decisions/0002`, which the proof tests before anything
else is built on it.
