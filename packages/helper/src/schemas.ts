/** Request body schemas. Every object is strict: unknown fields are rejected. */

import { pageUrlSchema, pinSchema } from "@squashflow/shared";
import { z } from "zod";

export { pageContextSchema, pageUrlSchema, pinSchema } from "@squashflow/shared";
export type { PageContext, PinInput } from "@squashflow/shared";

const MAX_PINS_PER_MESSAGE = 50;

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

export type PinsRequest = z.infer<typeof pinsRequestSchema>;
