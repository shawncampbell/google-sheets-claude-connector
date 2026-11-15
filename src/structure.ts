/**
 * Which changes Claude may ask Google for inside a spreadsheet (decisions/0005). Google
 * offers them all through one method that takes a list of requests, each named by its
 * one key. A request is passed on only if its name is on this list.
 *
 * The list is not there to stop Claude removing things. Removing a tab or rows is
 * allowed, because overwriting cells could always do as much damage and Google's version
 * history undoes both. What the list does is keep out kinds of request nobody has looked
 * at, such as ones Google adds later or ones that connect a sheet to outside data.
 *
 * Nothing this method offers can delete, share or move the spreadsheet file itself.
 */
export const ALLOWED_STRUCTURE_REQUESTS: ReadonlySet<string> = new Set([
  // Tabs
  "addSheet",
  "duplicateSheet",
  "updateSheetProperties",
  "deleteSheet",
  // The file's own title, locale and time zone
  "updateSpreadsheetProperties",
  // Rows, columns and ranges
  "deleteDimension",
  "deleteRange",
  "deleteDuplicates",
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
  "addSlicer",
  "updateSlicerSpec",
  // Tables
  "addTable",
  "updateTable",
  "deleteTable",
]);

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
      return `Request ${index + 1} is "${name}", which this connector does not pass on. Nothing was changed.`;
    }
  }
  return null;
}
