import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { DELETE_LIMIT_FOR_PEOPLE } from "./statement";

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
  button { font: inherit; padding: .5rem 1rem; margin-right: .5rem; }
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
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  headers.set("X-Frame-Options", "DENY");
  return headers;
};

const WHAT_IT_CAN_REACH = `
<p>If you continue, Google will ask you to let this connector see, edit, create and delete
<strong>only the specific Google Drive files you use with it</strong>. In practice that means:</p>
<ul>
  <li>It can create new sheets, and read and write the sheets it created.</li>
  <li>It cannot see any other file in your Google account.</li>
</ul>
<p class="limit"><strong>About deleting.</strong> ${escape(DELETE_LIMIT_FOR_PEOPLE)}</p>`;

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
${WHAT_IT_CAN_REACH}`,
  );
}

export function messagePage(title: string, message: string): string {
  return page(title, `<p>${escape(message)}</p>`);
}
