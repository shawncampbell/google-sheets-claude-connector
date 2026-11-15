import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { OPEN, OPEN_NAME } from "./groups";
import { DELETE_LIMIT_FOR_PEOPLE, instructionsSnippet, KEY_FOR_PEOPLE, OPEN_FOR_PEOPLE, PICK_FOR_PEOPLE } from "./statement";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 38rem; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.4rem; }
  .limit { border-left: 4px solid #b45309; background: #fffbeb; padding: .75rem 1rem; }
  button, select, input { font: inherit; padding: .4rem .7rem; margin-right: .5rem; }
  textarea { font: 14px/1.4 ui-monospace, monospace; width: 100%; box-sizing: border-box; }
  section { border-top: 1px solid #8884; margin-top: 1.5rem; padding-top: .5rem; }
  h2 { font-size: 1.1rem; }
  @media (prefers-color-scheme: dark) {
    body { color: #eee; background: #161616; }
    .limit { background: #2a2110; }
  }
</style>
<h1>${escape(title)}</h1>
${body}
</html>`;
}

export const htmlHeaders = (headers = new Headers()): Headers => {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  // form-action must name Google as well as this site. Chromium applies it to the
  // redirect that follows a form post, and blocks the hop to Google's sign-in without it.
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'",
  );
  headers.set("X-Frame-Options", "DENY");
  return headers;
};

const DELETE_LIMIT_BLOCK = `<p class="limit"><strong>About deleting.</strong> ${escape(DELETE_LIMIT_FOR_PEOPLE)}</p>`;

const WHAT_IT_CAN_REACH = `
<p>If you continue, Google will ask you to let this connector see, edit, create and delete
<strong>only the specific Google Drive files you use with it</strong>. In practice that means:</p>
<ul>
  <li>It can create new sheets, and read and write the sheets it created.</li>
  <li>It can read and write an existing sheet only after you pick that sheet for it.</li>
  <li>It cannot see any other file in your Google account.</li>
</ul>
${DELETE_LIMIT_BLOCK}`;

export function consentPage(details: ConsentDescription, handle: string): string {
  const name = escape(details.clientName || "An app");
  const origin = details.clientDomain
    ? `It is published by <strong>${escape(details.clientDomain)}</strong>.`
    : "It registered itself, so its name is not verified.";
  const loopback = details.redirectIsLoopback
    ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>"
    : "";
  return page(
    "Connect Google Sheets",
    `<p><strong>${name}</strong> is asking to use this connector. ${origin}
Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${loopback}
${WHAT_IT_CAN_REACH}
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <p><button name="decision" value="approve">Continue to Google</button>
  <button name="decision" value="deny">Cancel</button></p>
</form>`,
  );
}

export function homePage(): string {
  return page(
    "Google Sheets connector",
    `<p>This address is a connector for Claude. Add it in Claude's connector settings as a
custom connector, using this address followed by <code>/mcp</code>.</p>
<p>It lets Claude create, read and write Google Sheets while holding access only to the
sheets you chose, instead of your whole Google Drive.</p>
<p>Once it is connected, <a href="/manage">create a group and its key</a> for each Claude
Project that should use it, and <a href="/pick">give it a sheet that already exists</a>.</p>
${WHAT_IT_CAN_REACH}
<p><a href="/privacy">Privacy policy</a></p>`,
  );
}

/** What this copy of the connector does with data. Keep it true: change it when storage changes. */
export function privacyPage(): string {
  return page(
    "Privacy policy",
    `<p>This is one person's own copy of an open-source connector between Claude and Google
Sheets. It is run by whoever deployed it, for their own Google account. This page describes
what this copy does with data.</p>
<h2>What it asks Google for</h2>
<ul>
  <li>An opaque account id, to tell one Google account from another. It does not ask for
  your name, email address or profile.</li>
  <li>Access to only the specific Google Drive files you use with it: sheets it created and
  sheets you picked for it.</li>
</ul>
<h2>What it stores</h2>
<ul>
  <li>The Google access it was granted, encrypted under a key held by the person who runs
  this copy.</li>
  <li>The opaque Google account id.</li>
  <li>The names you give to groups of sheets, which sheet belongs to which group, and a
  fingerprint of each group's key. The keys themselves are not stored.</li>
  <li>Which sheet is the catalog, if you created one.</li>
  <li>Short-lived records of sign-ins in progress.</li>
</ul>
<p>If you create a catalog, the connector writes the titles of your reachable sheets, where
each is, and any note on what it is for into that one sheet in your own Drive. Those are
not kept on this server.</p>
<p>It does not store the contents of any sheet. Cells you read or write pass through it
on their way between Google and Claude and are not kept.</p>
<h2>How Google data is used</h2>
<p>Data from Google is used only to do what you ask through Claude: create, list, read and
write the sheets you chose. It is sent to Claude as the answer to those requests and to
nobody else. It is not sold, not used for advertising, and not used to train any model by
this connector. Nobody reads it except as needed to keep this copy working or as the law
requires.</p>
<h2>Who else handles it</h2>
<p>This copy runs on Cloudflare, which keeps request logs for the person who runs it.
What Claude does with the data it receives is covered by Anthropic's own policies.</p>
<h2>Taking access back</h2>
<p>Remove the connector in Claude's settings, and remove its access in your Google
account's settings for third-party connections. After that it can reach none of your
files.</p>
${DELETE_LIMIT_BLOCK}`,
  );
}

export function messagePage(title: string, message: string): string {
  return page(title, `<p>${escape(message)}</p>`);
}

type GroupChoice = { id: string; name: string };

/** Every place a sheet can go: each group, then the open space, which is never the default when a group exists. */
const groupSelect = (groups: GroupChoice[]) =>
  `<select name="group" required>${groups.map((g) => `<option value="${escape(g.id)}">${escape(g.name)}</option>`).join("")}<option value="${OPEN}">${OPEN_NAME} (no key)</option></select>`;

export function signInPage(returnTo: string): string {
  return page(
    "Sign in to manage this connector",
    `<p>This page is for the Google account that is connected in Claude. Signing in here asks
Google only who you are. It grants nothing new.</p>
<form method="post" action="/manage/sign-in">
  <input type="hidden" name="return" value="${escape(returnTo)}">
  <p><button>Sign in with Google</button></p>
</form>`,
  );
}

export function pickPage(groups: GroupChoice[]): string {
  const form = `<form method="post">
  <p><label>Add the sheets to: ${groupSelect(groups)}</label></p>
  <p>${escape(OPEN_FOR_PEOPLE)} A sheet added to a group can be reached only with that group's key.</p>
  <p><button name="decision" value="pick">Choose sheets in Google</button></p>
</form>`;
  return page(
    "Give the connector an existing sheet",
    `<p>${escape(PICK_FOR_PEOPLE)}</p>
<p>If you continue, Google will ask you to sign in and then show your spreadsheets. Choose
the ones to hand over. Sign in with the same Google account you connected in Claude.</p>
${DELETE_LIMIT_BLOCK}
<p>To take a sheet back later, remove this connector's access in your Google account's
settings for third-party connections. That takes back every sheet at once.</p>
${form}`,
  );
}

export function pickResultPage(groupName: string, added: string[], notAdded: number, openToAll = false): string {
  const list = added.length
    ? `<p>The connector can now read and write these, ${
        openToAll ? "<strong>from any chat on your account</strong>" : `from the Claude Project that holds the key for <strong>${escape(groupName)}</strong>`
      }:</p><ul>${added.map((title) => `<li>${escape(title)}</li>`).join("")}</ul>`
    : "<p>No sheet was added.</p>";
  const failed = notAdded
    ? `<p><strong>${notAdded} picked ${notAdded === 1 ? "file was" : "files were"} not added.</strong> This happens when
the pick was made with a different Google account from the one connected in Claude, or the
file is not a Google Sheet.</p>`
    : "";
  return page(
    added.length ? "Sheets added" : "Nothing was added",
    `${list}${failed}
${added.length ? DELETE_LIMIT_BLOCK : ""}
<p><a href="/pick">Pick more sheets</a> or <a href="/manage">manage groups</a>. You can close this page and go back to Claude.</p>`,
  );
}

type SheetRow = { spreadsheetId: string; title: string };

export function managePage(input: {
  groups: Array<GroupChoice & { sheets: SheetRow[] }>;
  open: SheetRow[];
  unplaced: SheetRow[];
  googleFailed: boolean;
  catalogLink: string | null;
  canAddGroup: boolean;
}): string {
  const catalog = `<section><h2>Catalog</h2>
<p>The catalog is one sheet in your Drive that lists every sheet this connector can reach,
where each one is, and a note on what it is for. The connector keeps it up to date. No chat
can write to it, and no chat can read it unless you place it in a group or under ${OPEN_NAME}.
It names every Project's sheets, so place it with care.</p>
${
  input.catalogLink
    ? `<p><a href="${escape(input.catalogLink)}" rel="noreferrer">Open the catalog in Google Sheets</a></p>
<form method="post" action="/manage/catalog"><button>Update the catalog now</button></form>`
    : `<form method="post" action="/manage/catalog"><button>Create the catalog</button> This adds one sheet to your Drive.</form>`
}</section>`;
  const move = (sheet: SheetRow, label: string) =>
    `<form method="post" action="/manage/sheets"><input type="hidden" name="sheet" value="${escape(sheet.spreadsheetId)}">
${escape(sheet.title)} ${groupSelect(input.groups)}<button>${label}</button></form>`;
  const groups = input.groups
    .map(
      (g) => `<section><h2>${escape(g.name)}</h2>
${g.sheets.length ? `<ul>${g.sheets.map((s) => `<li>${move(s, "Move")}</li>`).join("")}</ul>` : "<p>No sheets yet.</p>"}
<form method="post" action="/manage/key"><input type="hidden" name="group" value="${escape(g.id)}">
<button>Replace this group's key</button> Every chat holding the old key is cut off.</form></section>`,
    )
    .join("");
  const open = `<section><h2>${OPEN_NAME}</h2>
<p>${escape(OPEN_FOR_PEOPLE)} A sheet Claude creates in a chat with no key lands here.</p>
${input.open.length ? `<ul>${input.open.map((s) => `<li>${move(s, "Move")}</li>`).join("")}</ul>` : "<p>No sheets are open to any chat.</p>"}</section>`;
  const unplaced = input.unplaced.length
    ? `<section><h2>Not placed anywhere</h2>
<p>No chat can reach these until you put them in a group or open them to any chat.</p>
<ul>${input.unplaced.map((s) => `<li>${move(s, "Add")}</li>`).join("")}</ul></section>`
    : "";
  return page(
    "Groups and keys",
    `<p>Each group holds some sheets and has one key. Paste a group's key into the instructions
of one Claude Project, and chats in that Project can reach that group's sheets and no others.
A chat with no key reaches only the sheets under ${OPEN_NAME}.</p>
${DELETE_LIMIT_BLOCK}
${input.googleFailed ? "<p><strong>Google could not be reached, so sheets are not listed.</strong> Try again in a moment.</p>" : ""}
${groups || "<p>You have no groups yet.</p>"}
${open}
${unplaced}
${catalog}
<section><h2>Add a group</h2>
${
  input.canAddGroup
    ? `<form method="post" action="/manage/groups"><label>Name <input name="name" maxlength="60" required></label><button>Create group</button></form>`
    : "<p>This deployment holds as many groups as it can.</p>"
}</section>
<section><p><a href="/pick">Give the connector a sheet that already exists</a></p>
<form method="post" action="/manage/sign-out"><button>Sign out</button></form></section>`,
  );
}

export function keyPage(groupName: string, key: string, replaced: boolean): string {
  return page(
    replaced ? "The new key" : "The group's key",
    `<p>This is the key for <strong>${escape(groupName)}</strong>. <strong>It is shown once.</strong>
This server keeps only a fingerprint of it and cannot show it again. If you lose it, replace it.</p>
${replaced ? "<p>The old key has stopped working.</p>" : ""}
<p>Copy the text below into the instructions of the one Claude Project that should use this group:</p>
<textarea rows="4" readonly>${escape(instructionsSnippet(key))}</textarea>
<p class="limit"><strong>What this key is and is not.</strong> ${escape(KEY_FOR_PEOPLE)}</p>
<p><a href="/manage">Back to groups</a></p>`,
  );
}
