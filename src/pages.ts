import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { DELETE_LIMIT_FOR_PEOPLE, instructionsSnippet, KEY_FOR_PEOPLE, PICK_FOR_PEOPLE } from "./statement";

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
<p>Once it is connected, <a href="/manage">create a group and its key</a> for each Claude
Project that should use it, and <a href="/pick">give it a sheet that already exists</a>.</p>
${WHAT_IT_CAN_REACH}`,
  );
}

export function messagePage(title: string, message: string): string {
  return page(title, `<p>${escape(message)}</p>`);
}

type GroupChoice = { id: string; name: string };

const groupSelect = (groups: GroupChoice[]) =>
  `<select name="group" required>${groups.map((g) => `<option value="${escape(g.id)}">${escape(g.name)}</option>`).join("")}</select>`;

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
  const form = groups.length
    ? `<form method="post">
  <p><label>Add the sheets to this group: ${groupSelect(groups)}</label></p>
  <p><button name="decision" value="pick">Choose sheets in Google</button></p>
</form>`
    : `<p><strong>Create a group first.</strong> A picked sheet has to join a group, and you have
none yet. <a href="/manage">Create one</a>, then come back.</p>`;
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

export function pickResultPage(groupName: string, added: string[], notAdded: number): string {
  const list = added.length
    ? `<p>The connector can now read and write these, from the Claude Project that holds the key for
<strong>${escape(groupName)}</strong>:</p><ul>${added.map((title) => `<li>${escape(title)}</li>`).join("")}</ul>`
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
  unplaced: SheetRow[];
  googleFailed: boolean;
  canAddGroup: boolean;
}): string {
  const move = (sheet: SheetRow, label: string) =>
    input.groups.length
      ? `<form method="post" action="/manage/sheets"><input type="hidden" name="sheet" value="${escape(sheet.spreadsheetId)}">
${escape(sheet.title)} ${groupSelect(input.groups)}<button>${label}</button></form>`
      : escape(sheet.title);
  const groups = input.groups
    .map(
      (g) => `<section><h2>${escape(g.name)}</h2>
${g.sheets.length ? `<ul>${g.sheets.map((s) => `<li>${move(s, "Move")}</li>`).join("")}</ul>` : "<p>No sheets yet.</p>"}
<form method="post" action="/manage/key"><input type="hidden" name="group" value="${escape(g.id)}">
<button>Replace this group's key</button> Every chat holding the old key is cut off.</form></section>`,
    )
    .join("");
  const unplaced = input.unplaced.length
    ? `<section><h2>Sheets in no group</h2>
<p>No Claude Project can reach these until you put them in a group.</p>
<ul>${input.unplaced.map((s) => `<li>${move(s, "Add")}</li>`).join("")}</ul></section>`
    : "";
  return page(
    "Groups and keys",
    `<p>Each group holds some sheets and has one key. Paste a group's key into the instructions
of one Claude Project, and chats in that Project can reach that group's sheets and no others.
A chat with no key reaches nothing.</p>
${DELETE_LIMIT_BLOCK}
${input.googleFailed ? "<p><strong>Google could not be reached, so sheets are not listed.</strong> Try again in a moment.</p>" : ""}
${groups || "<p>You have no groups yet.</p>"}
${unplaced}
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
