# Roadmap

## Now

- Keep each Claude Project to its own sheets with a project key
  (https://github.com/shawncampbell/google-sheets-claude-connector/pull/8)
- Run the install runbook tasks not yet run: G, H and I

## Next

- A proof the owner can use in one Claude Project: sign in with Google for per-file
  access only, then create, read and write a sheet, with no delete tool (impact high,
  effort medium: it tests every fact the design rests on before more is built)
- Hand an existing sheet to the connector through Google's file picker (impact high,
  effort medium: without it the connector can only use sheets it created)
- Keep each Claude Project to its own sheets with a project key, as `decisions/0002`
  proposes (impact high, effort medium: it is the riskiest assumption in `PROJECT.md`)
- An automatic check on every PR for credentials and personal data (impact medium,
  effort low: this repository is public and a mistake cannot be fully undone)
- An install runbook someone else can follow to deploy their own copy (impact medium,
  effort medium: it is what makes the open source release usable)

## Later

- Choose a license and announce the project as open source
- A hosted version other people can use without deploying anything, which needs
  Google's app verification and a decision about holding other people's Google access
