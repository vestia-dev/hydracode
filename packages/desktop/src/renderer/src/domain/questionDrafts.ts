import type { Question } from "@opencode-ai/client/effect"

export interface AnswerDraft {
  readonly selectedOptions: ReadonlyArray<string>
  readonly customText: string
  readonly customEnabled: boolean
}

export const createAnswerDrafts = (request: Question.Request): ReadonlyArray<AnswerDraft> =>
  request.questions.map(() => ({ selectedOptions: [], customText: "", customEnabled: false }))

const updateDraft = (
  drafts: ReadonlyArray<AnswerDraft>,
  index: number,
  update: (draft: AnswerDraft) => AnswerDraft,
) => drafts.map((draft, currentIndex) => (currentIndex === index ? update(draft) : draft))

export function selectAnswerOption(
  drafts: ReadonlyArray<AnswerDraft>,
  index: number,
  label: string,
  multiple: boolean,
) {
  return updateDraft(drafts, index, (draft) => ({
    ...draft,
    selectedOptions: multiple
      ? draft.selectedOptions.includes(label)
        ? draft.selectedOptions.filter((option) => option !== label)
        : [...draft.selectedOptions, label]
      : [label],
    customEnabled: multiple ? draft.customEnabled : false,
  }))
}

export function toggleCustomAnswer(
  drafts: ReadonlyArray<AnswerDraft>,
  index: number,
  multiple: boolean,
) {
  return updateDraft(drafts, index, (draft) => ({
    ...draft,
    selectedOptions: multiple ? draft.selectedOptions : [],
    customEnabled: multiple ? !draft.customEnabled : true,
  }))
}

export function setCustomAnswer(
  drafts: ReadonlyArray<AnswerDraft>,
  index: number,
  customText: string,
) {
  return updateDraft(drafts, index, (draft) => ({ ...draft, customText }))
}

export function draftIsAnswered(draft: AnswerDraft | undefined) {
  return (
    draft !== undefined &&
    (draft.selectedOptions.length > 0 || (draft.customEnabled && draft.customText.trim() !== ""))
  )
}

export const answersFromDrafts = (
  drafts: ReadonlyArray<AnswerDraft>,
): ReadonlyArray<Question.Answer> =>
  drafts.map((draft) => {
    const custom = draft.customEnabled ? draft.customText.trim() : ""
    return custom === "" || draft.selectedOptions.includes(custom)
      ? [...draft.selectedOptions]
      : [...draft.selectedOptions, custom]
  })
