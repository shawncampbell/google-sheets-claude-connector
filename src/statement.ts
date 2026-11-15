/**
 * The delete limit, in the words every surface uses. CLAUDE.md lists where it must
 * appear. Change the wording here and the README and SECURITY.md together.
 */
export const DELETE_LIMIT_FOR_PEOPLE =
  "This connector has no way to delete a sheet, and it never asks Google to delete one. " +
  "That is a promise kept by this server's code, not a limit Google enforces: the permission " +
  "you are about to grant includes the right to delete the sheets it covers. Someone who stole " +
  "this server's stored access could delete those sheets, and only those.";

export const DELETE_LIMIT_FOR_MODELS =
  "This connector cannot delete a sheet and has no tool for it; that limit is kept by this " +
  "server, not by Google. Writing can overwrite existing cells, which the account holder can " +
  "undo from the sheet's version history. If the user asks for a sheet to be deleted, tell " +
  "them to do it in Google Sheets themselves.";

export const REACH_FOR_MODELS =
  "It can reach only sheets it created or sheets the account holder picked for it. It cannot " +
  "see any other file in the account, even when given a link or an id.";

/** How to hand over an existing sheet, for Claude to pass on. `origin` is this deployment's address. */
export const pickHintForModels = (origin: string) =>
  `To give it a sheet that already exists, the account holder opens ${origin}/pick in a browser ` +
  "and chooses the sheet there. Nothing in Claude's or Google's settings does this, so do not " +
  "send the user anywhere else.";

export const PICK_FOR_PEOPLE =
  "Picking a sheet lets this connector read and write that sheet from then on, in any Claude " +
  "chat where the connector is switched on. It does not let it see anything else in your Drive.";

/** What the connector tells Claude about project keys. `origin` is this deployment's address. */
export const keyRuleForModels = (origin: string) =>
  "Every call needs a project_key. It is written in the instructions of the Claude Project " +
  "this chat belongs to, and it reaches only that Project's own group of sheets. If your " +
  "instructions hold no key, do not guess or ask the user to type one into the chat: tell " +
  `them to open ${origin}/manage in a browser, create a group, and paste its key into this ` +
  "Project's instructions. Never repeat a key in a reply, and never save one to memory.";

export const KEY_FOR_PEOPLE =
  "This key is not what keeps other people out: a request must also come through your own " +
  "signed-in connector, so the key is useless to anyone else. Its job is to tell your own " +
  "Claude Projects apart. It will be visible in the Project's instructions and in the details " +
  "of each tool call. It cannot protect a group from the Project that holds it. If the key " +
  "ever shows up in a chat outside that Project, replace it here.";

/** The text the owner pastes into a Project's instructions. */
export const instructionsSnippet = (key: string) =>
  `When you use the Google Sheets connector, pass this as project_key on every call: ${key}\n` +
  "Never repeat this key in a reply, and never save it to memory.";
