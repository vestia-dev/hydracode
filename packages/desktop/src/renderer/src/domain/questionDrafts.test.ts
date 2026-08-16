import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Question, Session } from "@opencode-ai/client/effect"
import {
  answersFromDrafts,
  createAnswerDrafts,
  draftIsAnswered,
  selectAnswerOption,
  setCustomAnswer,
  toggleCustomAnswer,
} from "./questionDrafts"

const request: Question.Request = {
  id: Question.ID.create(),
  sessionID: Session.ID.create(),
  questions: [
    { header: "One", question: "First?", options: [], multiple: false },
    { header: "Two", question: "Second?", options: [], multiple: true },
  ],
}

it.effect("keeps every question's answer fields in one draft", () =>
  Effect.sync(() => {
    let drafts = createAnswerDrafts(request)
    drafts = selectAnswerOption(drafts, 0, "First option", false)
    drafts = toggleCustomAnswer(drafts, 1, true)
    drafts = setCustomAnswer(drafts, 1, "Custom second answer")

    expect(drafts).toEqual([
      {
        selectedOptions: ["First option"],
        customText: "",
        customEnabled: false,
      },
      {
        selectedOptions: [],
        customText: "Custom second answer",
        customEnabled: true,
      },
    ])
    expect(answersFromDrafts(drafts)).toEqual([["First option"], ["Custom second answer"]])
    expect(draftIsAnswered(drafts[1])).toBe(true)
  }),
)

it.effect(
  "keeps multi-select choices but clears single-select choices when custom is enabled",
  () =>
    Effect.sync(() => {
      const initial = createAnswerDrafts(request)
      const single = toggleCustomAnswer(
        selectAnswerOption(initial, 0, "Only option", false),
        0,
        false,
      )
      const multiple = toggleCustomAnswer(
        selectAnswerOption(initial, 1, "One option", true),
        1,
        true,
      )

      expect(single[0]?.selectedOptions).toEqual([])
      expect(single[0]?.customEnabled).toBe(true)
      expect(multiple[1]?.selectedOptions).toEqual(["One option"])
      expect(multiple[1]?.customEnabled).toBe(true)
    }),
)
