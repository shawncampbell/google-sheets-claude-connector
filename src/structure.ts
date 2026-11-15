/**
 * Which structural changes Claude may ask Google for (decisions/0005). Google offers
 * them all through one method that takes a list of requests, each named by its one key.
 * A request is passed on only if its name is on this list. A name Google adds later is
 * refused until someone adds it here on purpose.
 *
 * Left out on purpose, because each removes a tab or rows of the owner's data, or changes
 * the file itself: deleteSheet, deleteDimension, deleteRange, deleteDuplicates,
 * updateSpreadsheetProperties. Do not add one without a decision record.
 */
export const ALLOWED_STRUCTURE_REQUESTS: ReadonlySet<string> = new Set([
  // Tabs
  "addSheet",
  "duplicateSheet",
  "updateSheetProperties",
  // Rows, columns and cells: adding, moving and sizing, never removing
  "insertDimension",
  "appendDimension",
  "insertRange",
  "moveDimension",
  "updateDimensionProperties",
  "autoResizeDimensions",
  "addDimensionGroup",
  "updateDimensionGroup",
  "deleteDimensionGroup",
  "mergeCells",
  "unmergeCells",
  // Cell contents and formatting
  "updateCells",
  "repeatCell",
  "appendCells",
  "copyPaste",
  "cutPaste",
  "pasteData",
  "autoFill",
  "findReplace",
  "textToColumns",
  "trimWhitespace",
  "sortRange",
  "randomizeRange",
  "updateBorders",
  // Dropdowns and other rules on what a cell accepts
  "setDataValidation",
  // Conditional formatting, banding, filters
  "addConditionalFormatRule",
  "updateConditionalFormatRule",
  "deleteConditionalFormatRule",
  "addBanding",
  "updateBanding",
  "deleteBanding",
  "setBasicFilter",
  "clearBasicFilter",
  "addFilterView",
  "updateFilterView",
  "duplicateFilterView",
  "deleteFilterView",
  // Named ranges, protected ranges, charts
  "addNamedRange",
  "updateNamedRange",
  "deleteNamedRange",
  "addProtectedRange",
  "updateProtectedRange",
  "deleteProtectedRange",
  "addChart",
  "updateChartSpec",
  "updateEmbeddedObjectPosition",
  "updateEmbeddedObjectBorder",
  "deleteEmbeddedObject",
]);

export const REFUSED_STRUCTURE_REQUESTS = ["deleteSheet", "deleteDimension", "deleteRange", "deleteDuplicates", "updateSpreadsheetProperties"];

/** The reason a list of requests cannot be sent, or null when every one is allowed. */
export function whyNotAllowed(requests: unknown[]): string | null {
  for (const [index, request] of requests.entries()) {
    if (typeof request !== "object" || request === null || Array.isArray(request)) {
      return `Request ${index + 1} is not an object.`;
    }
    const names = Object.keys(request);
    if (names.length !== 1) return `Request ${index + 1} must have exactly one key, naming the kind of change.`;
    const name = names[0]!;
    if (!ALLOWED_STRUCTURE_REQUESTS.has(name)) {
      return REFUSED_STRUCTURE_REQUESTS.includes(name)
        ? `Request ${index + 1} is "${name}", which this connector never does: it removes a tab or rows of data, or changes the file itself. ` +
            "Tell the user to do that in Google Sheets themselves. Nothing was changed."
        : `Request ${index + 1} is "${name}", which this connector does not pass on. Nothing was changed.`;
    }
  }
  return null;
}
