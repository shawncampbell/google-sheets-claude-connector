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
  "see any other file in the account, even when given a link.";
