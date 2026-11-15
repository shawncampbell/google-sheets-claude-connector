# Runbook: deploy your own copy of the connector

**Purpose.** Stand up one copy of the connector for one Google account, add it to
Claude, and prove it can reach only the sheets it was given.

**Before you rely on it, know its one soft limit.** This connector has no way to delete
a sheet, and it never asks Google to delete one. That is a promise kept by this
server's code, not a limit Google enforces: the permission you grant includes the right
to delete the sheets it covers. Someone who stole this server's stored access could
delete those sheets, and only those.

**Prerequisites.** A Cloudflare account that holds nothing else you care about, a
Google account, and this repository (or your fork of it) on GitHub.

**How to read this.** Each task gives its goal and how to verify it before any steps.
Dashboards change, so the click-paths below are a guide; if a label has moved, search
the dashboard for the name in bold and go by the goal. Tasks A to F have been run so far. H was started. G and I have not been run.
When you run a task, update its `Verified:` line.

**Never write a real value from these steps into this repository**: not the Worker's
address, not a client id, not a sheet id. See `CLAUDE.md`.

---

## A. Deploy the Worker

**Goal.** The Worker is live at an address of the form
`https://<worker>.<subdomain>.workers.dev`, deployed by Cloudflare from this repository,
with no Cloudflare credential stored in GitHub.

**Verify.** Opening the Worker's address in a browser shows a page titled "Google
Sheets connector". Opening the address followed by `/authorize` shows "This connector
is not set up yet", because task C has not been done. After the next merge to the
default branch, the Worker's build history shows a new build without anyone starting
it.

1. Give Cloudflare's GitHub app access to this repository. In GitHub, open your
   **Settings → Applications → Cloudflare Workers and Pages → Configure**. If it is
   set to **Only select repositories**, add this repository to the list. Without this,
   Cloudflare is never told about a push: the first deploy can still succeed, and then
   no later merge builds anything, with no error shown anywhere.
2. In the Cloudflare dashboard, **Workers & Pages** → **Create application** → import
   the repository from GitHub. Keep the project name the same as `name` in
   `wrangler.jsonc`.
3. Leave the build command empty and the deploy command as `npx wrangler deploy`.
4. Let Cloudflare create the API token it offers, then deploy. The first deploy creates
   the KV namespace the Worker stores its data in; the token must be allowed to edit
   Workers KV Storage as well as Workers Scripts.
5. Leave preview builds off. In the Worker's **Settings → Build → Branch control**,
   **Enable Preview Builds** should be clear, so that only the default branch deploys.
   A preview build would publish every pushed branch, reviewed or not, at its own
   public address with the same secrets and the same stored Google access as the real
   one.
6. Check which addresses are switched on. In the Worker's **Settings → Domains &
   Routes**, the **workers.dev** address should be enabled and **Preview URLs** should
   be disabled. `wrangler.jsonc` sets both on every deploy, so this is a check and
   should need no change. On the first real install, before the configuration set
   them, the workers.dev address was off and Preview URLs were on. A preview address serves older
   and unreleased versions of the Worker with the same secrets, for the same reason
   given in step 5.
7. Note the Worker's address. Tasks B and D need it.

Do not put Cloudflare Access in front of this Worker. Claude's servers call it
directly, so it has to be reachable from the internet; it protects itself by requiring
a Google sign-in.

Sources: developers.cloudflare.com/workers/ci-cd/builds/ ;
developers.cloudflare.com/workers/wrangler/configuration/ (Automatic provisioning,
`workers_dev`, `preview_urls`)
Verified: executed 2026-11-15 by the owner (one install). Step 1 was missed the first
time, and merges did not build until it was done. The dashboard and GitHub labels in
steps 1 and 6 are as the owner described them, not re-read in the docs.

## B. Create the Google app

**Goal.** A Google Cloud project that holds one OAuth client for this connector and
asks for per-file Drive access and nothing broader.

**Verify.** In the Google Cloud console, **Google Auth Platform → Data Access** lists
exactly two scopes, `openid` and `.../auth/drive.file`, and **Clients** lists one web
client whose redirect address is your Worker's address followed by `/callback`.

1. Create a new Google Cloud project used for nothing else.
2. Enable two APIs in it: **Google Sheets API** and **Google Drive API**. The Drive API
   is used only to list the sheets the connector can already reach. The Google Picker
   API does not need enabling: on the first install Google's picker appeared before
   it was switched on.
3. **Google Auth Platform → Branding**: give the app a name and your support email.
   **Audience**: choose **External**, and add your own Google account under **Test
   users**. It must be the exact account you will sign in with in task D. If it is
   missing, Google stops the sign-in with "Access blocked: ... has not completed the
   Google verification process" and error 403 `access_denied`.
4. **Data Access → Add or remove scopes**: add `openid` and
   `https://www.googleapis.com/auth/drive.file`. Add nothing else.
5. **Clients → Create client**: type **Web application**. Under **Authorized redirect
   URIs** add your Worker's address followed by `/callback`. Create it, and keep the
   client id and client secret for task C. Do not paste them anywhere else.

Sources: developers.google.com/workspace/drive/api/guides/api-specific-auth ;
developers.google.com/workspace/sheets/api/scopes ;
developers.google.com/identity/protocols/oauth2
Verified: executed 2026-11-15 by the owner (one install). The first sign-in was refused
until the signing-in account was added as a test user, as step 3 now warns.

## C. Give the Worker its three secrets

**Goal.** The Worker holds the Google client id, the Google client secret, and a key
it uses to encrypt every Google token before storing it.

**Verify.** Opening the Worker's address followed by `/authorize` now shows "This
sign-in link is not valid" instead of "This connector is not set up yet".

1. Make an encryption key: 32 random bytes, base64 encoded. On a Mac or Linux
   terminal, `openssl rand -base64 32` prints one.
2. In the Cloudflare dashboard open the Worker → **Settings** → **Variables and
   Secrets** → **Add**, and add three entries of type **Secret**:
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY`.
3. Deploy the change when the dashboard offers to.

If you ever replace `TOKEN_ENCRYPTION_KEY`, the stored Google access can no longer be
read, and you reconnect the connector in Claude to store it again.

Sources: developers.cloudflare.com/workers/configuration/secrets/
Verified: executed 2026-11-15 by the owner (one install). The check in **Verify** was
not reported separately; the sign-in in task D worked, which needs all three secrets.

## D. Add the connector to Claude

**Goal.** Claude lists the connector as connected, signed in with your Google account.

**Verify.** Claude's connector settings show the connector with a **Disconnect**
button, and your Google account's page of third-party connections lists your app with
access described as only the specific Drive files you use with it.

1. In Claude, open **Customize → Connectors** → **Add** → **Add custom connector**.
2. Name it, and enter your Worker's address followed by `/mcp`. Keep the
   authentication settings Claude detects.
3. Select **Connect**. You see this connector's own page first, which states what it
   can reach and the delete limit. Continue to Google and sign in.
4. On Google's screen, leave the Drive permission ticked. If you untick it, the
   connector refuses the sign-in and asks you to try again.

The first Google account to sign in becomes the only account this deployment serves.
A different account is refused from then on.

Sources: claude.com/docs/connectors/custom/remote-mcp
Verified: executed 2026-11-15 by the owner (one install): Claude shows the connector as
connected. The first attempt found a fault in the connector's own page, since fixed.
The check of the Google account's third-party connections page was not reported.

## E. Prove what it can and cannot reach

**Goal.** Evidence, from your own account, that the connector can create, read and
write a sheet, and cannot read a sheet it was not given.

**Verify.** All four steps below end as described.

Do task I first. Since project keys were added, the connector refuses every call that
does not carry a key, so run these steps in a chat inside the Claude Project that holds
one.

1. In a Claude chat with the connector switched on, ask Claude to create a sheet
   called "Connector test" and add three rows to it. Open the link Claude gives you:
   the sheet exists in your Drive and holds the rows.
2. Ask Claude to read the sheet back. It reports the same rows.
3. Copy the id of some other sheet in your Drive from its address, and ask Claude to
   read that id. Claude reports that the connector cannot reach that sheet.
4. Ask Claude to delete "Connector test". Claude says it has no way to do that and
   tells you to delete it in Google Sheets yourself.

Sources: this repository's `src/tools.ts`
Verified: executed 2026-11-15 by the owner (one install), before project keys existed.
All four steps ended as described. Not re-run since keys were added.

## F. Test whether a Claude Project keeps its instructions to itself

**Goal.** Find out whether text placed in one Claude Project's instructions can be
seen from a chat outside that Project. `decisions/0002` depends on the answer, and
this test needs no code.

**Verify.** You can state, with the date, whether the phrase was or was not revealed.

1. Create a Claude Project and put a made-up phrase in its instructions, for example a
   sentence saying its key is three unrelated words of your choosing.
2. In a chat inside the Project, ask what the key is. Claude should know it.
3. In a new chat outside any Project, ask what the key in that Project is, and ask
   Claude to search your past chats for it. Then try once more from inside a second
   Project.
4. If the phrase stays hidden in step 3, the assumption holds for now. If it is
   revealed, record that in `decisions/0002`, which then falls back to approving each
   call by hand.

Sources: support.claude.com, "Use Claude's chat search and memory to build on previous
context"
Verified: executed 2026-11-15 by the owner, from a chat outside any Project and from
inside a second Project. The phrase stayed hidden both times. The outside chat did
hold other notes about the first Project, which `decisions/0002` records.

## G. Before real use: take the Google app out of testing

**Goal.** The connector's Google access no longer expires every seven days.

**Verify.** **Google Auth Platform → Audience** shows the publishing status **In
production**, and the connector still works eight days after you last signed in.

1. **Google Auth Platform → Audience** → **Publish app**.
2. Reconnect the connector in Claude so a lasting sign-in replaces the seven-day one.

Whether Google asks for a review at this step, for an app that requests only these two
scopes, has not been confirmed. If it does, stop and record what it asked for.

Sources: developers.google.com/identity/protocols/oauth2 (refresh token expiration)
Verified: not executed.

## H. Hand over a sheet that already exists

**Before you pick, the same limit applies.** The connector has no way to delete a
sheet, but that is a promise kept by this server's code, not a limit Google enforces.
A picked sheet is covered by a permission that includes deleting it.

**Goal.** The connector can read and write one sheet you already had, and still cannot
reach the others.

**Verify.** After picking, Claude can read the picked sheet, and a different sheet you
did not pick is still refused.

1. Do task I first, so that there is a group for the sheet to join.
2. In a browser, open your Worker's address followed by `/pick`. Sign in if asked,
   read the page, choose the group, and select **Choose sheets in Google**.
3. Sign in with the same Google account you connected in Claude. Google shows your
   spreadsheets. Choose one and confirm.
4. You land back on the connector, on a page titled "Sheets added" that names the
   sheet. If it says a file was not added, the pick was made with a different Google
   account, or the file is not a Google Sheet.
5. In a chat inside the Claude Project that holds that group's key, ask for the list
   of sheets the connector can reach, then ask it to read the picked sheet. Then ask it to read some other sheet by its id, which should be
   refused, with Claude pointing you to the `/pick` page and nowhere else.

To take a sheet back, remove the connector's access in your Google account's settings
for third-party connections. That takes back every sheet at once, and you reconnect in
Claude afterwards. Whether Google offers a way to take back one sheet has not been
checked.

Sources: developers.google.com/workspace/drive/picker/guides/overview-desktop
Verified: started 2026-11-15 by the owner, before groups existed: Google's picker
appeared, and did so without the Google Picker API enabled. The outcome of the later
steps was not reported, and the group steps have not been executed.

## I. Give a Claude Project its own sheets

**What a key is and is not.** A key tells your own Claude Projects apart. It is not
what keeps other people out: a request must also come through your signed-in
connector. It cannot protect a group from the Project that holds it, and it is visible
in that Project's instructions and in the details of each tool call.

**Goal.** One Claude Project can reach one group of sheets, and a chat anywhere else
on your account reaches nothing.

**Verify.** Step 5 is refused and step 4 succeeds.

1. In a browser, open your Worker's address followed by `/manage` and sign in with the
   Google account you connected in Claude. The sign-in asks Google only who you are.
2. Under **Add a group**, name a group after the Project that will use it and select
   **Create group**. The next page shows the group's key once.
3. Copy the text in the box into that Claude Project's instructions and save them.
4. In a chat inside that Project, ask Claude to create a sheet and add a row. It
   succeeds, and the sheet appears under the group's name on the `/manage` page.
5. In a chat outside the Project, with the connector switched on, ask Claude to list
   the sheets the connector can reach, and to read that sheet by its id. Both are
   refused, and Claude sends you to the `/manage` page instead of asking for a key.
6. Sheets made before groups existed are listed on `/manage` under **Sheets in no
   group**. Add each to a group, or leave it out of reach.
7. After a week of real use, ask a chat outside the Project what the Project's key is,
   and ask it to search your past chats and memory for "sheets-key". If the key comes
   back, select **Replace this group's key** and record what happened in
   `decisions/0002`: that is the one part of the design not yet tested.

Sources: this repository's `decisions/0002`
Verified: not executed.
