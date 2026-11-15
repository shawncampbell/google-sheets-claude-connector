# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project files, rules for working in a public repository, a security policy, and two
  proposed decision records: building our own connector on per-file access, and a
  project key that keeps each Claude Project to its own sheets.
- A first proof of the connector: sign in with Google for per-file access, then create
  a sheet, list reachable sheets, read, write and append. There is no delete tool.
  It passes its tests against a stand-in for Google and has not yet been run against
  a real account.
- An install runbook, `runbooks/install.md`, with a task that tests whether a Claude
  Project keeps its instructions to itself.

- A page for handing the connector a sheet that already exists. Open the connector's
  address followed by `/pick`, choose sheets in Google's own picker, and the connector
  can read and write them from then on. Claude is told where the page is. Not yet run
  against a real account.

- Project keys. Sheets are kept in groups, each with a key, managed on the connector's
  `/manage` page. Every tool call must carry a key and reaches only that key's group,
  so a sheet given to one Claude Project stays out of reach of other chats. Not yet
  run against a real account.

- A privacy policy page at `/privacy`, linked from the home page, saying what a copy of
  the connector asks Google for, what it stores, and what it does not. Google requires
  one before an app can leave testing.

- Sheets open to any chat. On `/manage` and `/pick` a sheet can be placed under "Any
  chat" instead of a group, and is then reachable from every chat on the account with
  no key.

- A catalog. From `/manage` you can have the connector create and keep one sheet that
  lists every sheet it can reach, where each is, and a note on what it is for. Claude
  can give a one-line purpose when it creates a sheet, which becomes the first note.

### Changed

- A call with no project key is no longer refused. It reaches only the sheets open to
  any chat, and a sheet it creates is open to any chat. A call with a wrong key is
  still refused. Sheets not yet placed anywhere stay out of reach.

- Every tool now refuses a call that carries no project key. After upgrading, create a
  group on `/manage` and paste its key into a Claude Project before using the
  connector. Sheets made earlier appear there under "Sheets in no group".
- Handing over an existing sheet on `/pick` now needs a sign-in and a group to add the
  sheet to.

### Fixed

- When asked to read a sheet it could not reach, Claude told the user to share the
  sheet through a settings page that does not exist. The connector now tells Claude
  exactly where an existing sheet is handed over, and to send the user nowhere else.
- Connecting in Chrome stopped at the connector's own page: pressing Continue did
  nothing, and pressing it again showed "This authorization was not started in this
  browser". A security header on that page was blocking the hop to Google's sign-in.

### Removed
