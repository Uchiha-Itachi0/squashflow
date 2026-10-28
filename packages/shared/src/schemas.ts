/**
 * Pin and page context schemas, shared by the helper (which validates request bodies)
 * and the extension (which validates what it reads back from storage).
 * Every object is strict: unknown fields are rejected.
 */

// Namespace import: Parcel (the extension bundler) mis-bundles zod's `z` re-export.
import * as z from "zod";
import { screenshotSchema } from "./screenshot.js";

export const MAX_COMMENT_CHARS = 8000;
export const MAX_FIELD_CHARS = 4000;
export const MAX_MAP_ENTRIES = 100;
export const MAX_URL_CHARS = 4000;
/** Extra elements on one pin (several elements, or the elements inside a dragged area). */
export const MAX_EXTRA_ELEMENTS = 20;

const boundedText = z.string().max(MAX_FIELD_CHARS);
const boundedMap = z
  .record(z.string().max(200), boundedText)
  .refine((map) => Object.keys(map).length <= MAX_MAP_ENTRIES, "too many entries");

export const pageUrlSchema = z
  .string()
  .max(MAX_URL_CHARS)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "must be an http or https URL");

const coordinate = z.number();

/** A box in page coordinates (CSS pixels from the top left of the document). */
export const rectSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
  width: coordinate.nonnegative(),
  height: coordinate.nonnegative(),
});

export const viewportSchema = z.strictObject({
  width: coordinate.nonnegative(),
  height: coordinate.nonnegative(),
  scrollX: coordinate,
  scrollY: coordinate,
  devicePixelRatio: coordinate.positive(),
});

export const sourceLocationSchema = z.strictObject({
  file: z.string().min(1).max(1000),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
});

/** What was captured about one element. */
export const elementContextSchema = z.strictObject({
  selector: boundedText.optional(),
  text: boundedText.optional(),
  attributes: boundedMap.optional(),
  styles: boundedMap.optional(),
  /** An indented outline of the element's ancestors, siblings and children. */
  structure: boundedText.optional(),
  rect: rectSchema.optional(),
  source: sourceLocationSchema.optional(),
});

/**
 * Context for one pin. The top-level element fields describe the pinned element
 * (for a text selection, the element holding it; for a dragged area, the element
 * enclosing it). `elements` lists the other elements of a multi-element or area pin.
 */
export const pageContextSchema = z.strictObject({
  ...elementContextSchema.shape,
  kind: z.enum(["element", "text", "area", "elements"]).optional(),
  selectedText: boundedText.optional(),
  area: rectSchema.optional(),
  elements: z.array(elementContextSchema).max(MAX_EXTRA_ELEMENTS).optional(),
  viewport: viewportSchema.optional(),
});

export const pinSchema = z.strictObject({
  comment: z.string().trim().min(1).max(MAX_COMMENT_CHARS),
  context: pageContextSchema.optional(),
  /** A crop of the visible tab around the pin. */
  screenshot: screenshotSchema.optional(),
});

export type Rect = z.infer<typeof rectSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
export type ElementContext = z.infer<typeof elementContextSchema>;
export type PageContext = z.infer<typeof pageContextSchema>;
export type PinKind = NonNullable<PageContext["kind"]>;
export type PinInput = z.infer<typeof pinSchema>;
