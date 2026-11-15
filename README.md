# google-sheets-claude-connector

A connector that lets Claude create, read and write Google Sheets while holding access
only to the sheets you chose. Claude's own Google Drive connector can read every file
in your Drive. This one asks Google for per-file access, so it can reach a sheet only
if it created that sheet or you picked it in Google's file picker.

**Status: design stage.** Nothing here runs yet. The plan is in `ROADMAP.md` and the
reasoning is in `decisions/`.

## What it will and will not do

- It creates new sheets, reads sheets it was given, and writes to them.
- It cannot see any other file in your Google account.
- It has no tool that deletes a sheet.

**Read this before relying on the last point.** Google's per-file permission includes
the right to delete the files it covers. The connector never asks Google to delete
anything, but that is a promise kept by this server's code, not a limit Google
enforces. Someone who stole the connector's stored access could delete the sheets you
granted, and only those. Claude can also overwrite the contents of a sheet it may
write to, which Google's version history can undo.

## How it is built

One Cloudflare Worker that speaks the Model Context Protocol, added to Claude as a
custom connector. You sign in with Google when you connect it, and the Worker keeps
your Google access encrypted. You deploy your own copy; a shared hosted version is on
the roadmap and is not available.

## Security

How to report a problem, and what this project does to keep private data out of a
public repository: `SECURITY.md`.
