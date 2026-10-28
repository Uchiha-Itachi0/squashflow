/** Request body schemas, shared with the extension. Every object is strict: unknown fields are rejected. */

export {
  pageContextSchema,
  pageUrlSchema,
  pairRequestSchema,
  pinSchema,
  pinsRequestSchema,
} from "@squashflow/shared";
export type { PageContext, PinInput, PinsRequest } from "@squashflow/shared";
