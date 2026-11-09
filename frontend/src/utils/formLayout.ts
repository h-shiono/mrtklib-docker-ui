/** Screen and form geometry (DESIGN.md "Layout"). */

/** A screen's height: the window less the header (52), footer (30) and page
 *  padding (32). Columns take this and scroll inside themselves. */
export const SCREEN_HEIGHT = 'calc(100dvh - 114px)';

/** Smallest chart or text area, for windows too short to fit everything. */
export const MIN_PANEL_HEIGHT = 200;

export const FORM_LABEL_WIDTH = 130;
export const FORM_LABEL_GAP = 8;
/** Height of an xs input, which every row reserves so that rows keep one pitch. */
export const FORM_ROW_HEIGHT = 30;
