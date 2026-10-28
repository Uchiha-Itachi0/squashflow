/** Request body schemas. Every object is strict: unknown fields are rejected. */

import { z } from "zod";

const MAX_COMMENT_CHARS = 8000;
const MAX_PINS_PER_MESSAGE = 50;
const MAX_URL_CHARS = 4000;
const MAX_FIELD_CHARS = 4000;
const MAX_MAP_ENTRIES = 100;

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

export const pageContextSchema = z.strictObject({
  selector: boundedText.optional(),
  text: boundedText.optional(),
  attributes: boundedMap.optional(),
  styles: boundedMap.optional(),
  source: z
    .strictObject({
      file: z.string().min(1).max(1000),
      line: z.number().int().positive().optional(),
      column: z.number().int().positive().optional(),
    })
    .optional(),
});

export const pinSchema = z.strictObject({
  comment: z.string().trim().min(1).max(MAX_COMMENT_CHARS),
  context: pageContextSchema.optional(),
});

export const pinsRequestSchema = z.strictObject({
  session: z.union([z.number().int().positive(), z.string().min(1).max(200)]),
  pageUrl: pageUrlSchema,
  pins: z.array(pinSchema).min(1).max(MAX_PINS_PER_MESSAGE),
  /** Build and return the exact message without delivering it. */
  preview: z.boolean().optional(),
  /** From the preview response; required to deliver. */
  pinId: z
    .string()
    .regex(/^sf-[0-9a-f]{12}$/)
    .optional(),
  digest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

export const pairRequestSchema = z.strictObject({
  code: z.string().min(1).max(32),
});

export type PageContext = z.infer<typeof pageContextSchema>;
export type PinInput = z.infer<typeof pinSchema>;
export type PinsRequest = z.infer<typeof pinsRequestSchema>;
