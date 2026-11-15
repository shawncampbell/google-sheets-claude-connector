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

### Changed

### Fixed

- Connecting in Chrome stopped at the connector's own page: pressing Continue did
  nothing, and pressing it again showed "This authorization was not started in this
  browser". A security header on that page was blocking the hop to Google's sign-in.

### Removed
