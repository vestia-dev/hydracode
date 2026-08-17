import { Schema } from "effect"

export const SavedPrompt = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  createdAt: Schema.Number,
})
export type SavedPrompt = typeof SavedPrompt.Type

export const SavedPromptState = Schema.Struct({
  version: Schema.Literal(1),
  prompts: Schema.Array(SavedPrompt),
})
export type SavedPromptState = typeof SavedPromptState.Type

export const SavePromptCommand = Schema.Struct({ text: Schema.String })
export type SavePromptCommand = typeof SavePromptCommand.Type

export const CopyPromptCommand = Schema.Struct({ text: Schema.String })
export type CopyPromptCommand = typeof CopyPromptCommand.Type

export const SavedPromptsResult = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Success"), prompts: Schema.Array(SavedPrompt) }),
  Schema.Struct({ _tag: Schema.Literal("Failure"), message: Schema.String }),
])
export type SavedPromptsResult = typeof SavedPromptsResult.Type
