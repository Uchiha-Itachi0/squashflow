/** Request body schemas, shared with the extension. Every object is strict: unknown fields are rejected. */

export {
  followUpRequestSchema,
  pageContextSchema,
  pageUrlSchema,
  pairRequestSchema,
  pinSchema,
  pinsRequestSchema,
} from "@squashflow/shared";
export type { FollowUpRequest, PageContext, PinInput, PinsRequest } from "@squashflow/shared";
