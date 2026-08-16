import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import type { Question } from "@opencode-ai/client/effect"
import { Effect, Fiber } from "effect"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { AppRuntime } from "../runtime"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import {
  answersFromDrafts,
  createAnswerDrafts,
  draftIsAnswered,
  selectAnswerOption,
  setCustomAnswer,
  toggleCustomAnswer,
} from "../domain/questionDrafts"

type SubmissionState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Replying" }
  | { readonly _tag: "Rejecting" }
  | { readonly _tag: "Error"; readonly message: string }

export interface SessionQuestionNodeData extends Record<string, unknown> {
  readonly request: Question.Request
  readonly reply: (
    answers: ReadonlyArray<Question.Answer>,
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly reject: () => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly focusRequest?: number
}

export type SessionQuestionFlowNode = Node<SessionQuestionNodeData, "sessionQuestion">

export function SessionQuestionNode({ data }: NodeProps<SessionQuestionFlowNode>) {
  const [index, setIndex] = useState(0)
  const [drafts, setDrafts] = useState(() => createAnswerDrafts(data.request))
  const [submission, setSubmission] = useState<SubmissionState>({ _tag: "Idle" })
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const customButton = useRef<HTMLButtonElement>(null)
  const customInput = useRef<HTMLTextAreaElement>(null)
  const submissionFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const requestID = data.request.id
  const question = data.request.questions[index]
  const draft = drafts[index]
  const sending = submission._tag === "Replying" || submission._tag === "Rejecting"

  useEffect(() => {
    setIndex(0)
    setDrafts(createAnswerDrafts(data.request))
    setSubmission({ _tag: "Idle" })
  }, [requestID])

  useEffect(
    () => () => {
      const fiber = submissionFiber.current
      if (fiber !== null) AppRuntime.runFork(Fiber.interrupt(fiber))
    },
    [],
  )

  useEffect(() => {
    if (data.focusRequest === undefined || sending) return
    const target = draft?.customEnabled
      ? (customInput.current ?? customButton.current)
      : (optionRefs.current[0] ?? customButton.current)
    target?.focus({ preventScroll: true })
  }, [data.focusRequest, draft?.customEnabled, sending])

  const run = useCallback(
    (
      state: "Replying" | "Rejecting",
      effect: Effect.Effect<void, DesktopBridgeError, DesktopBridge>,
    ) => {
      const previous = submissionFiber.current
      if (previous !== null) AppRuntime.runFork(Fiber.interrupt(previous))
      setSubmission({ _tag: state })
      submissionFiber.current = AppRuntime.runFork(
        effect.pipe(
          Effect.catch((error) =>
            Effect.sync(() => setSubmission({ _tag: "Error", message: error.message })),
          ),
        ),
      )
    },
    [],
  )

  const answers = useCallback(() => answersFromDrafts(drafts), [drafts])

  const submit = useCallback(() => {
    if (sending) return
    run("Replying", data.reply(answers()))
  }, [answers, data, run, sending])

  const dismiss = useCallback(() => {
    if (sending) return
    run("Rejecting", data.reject())
  }, [data, run, sending])

  const next = useCallback(() => {
    if (index >= data.request.questions.length - 1) submit()
    else setIndex((current) => current + 1)
  }, [data.request.questions.length, index, submit])

  const select = (label: string) => {
    if (question === undefined || sending) return
    setSubmission({ _tag: "Idle" })
    setDrafts((current) => selectAnswerOption(current, index, label, question.multiple === true))
  }

  const activateCustom = () => {
    if (question === undefined || sending) return
    setSubmission({ _tag: "Idle" })
    setDrafts((current) => toggleCustomAnswer(current, index, question.multiple === true))
    window.requestAnimationFrame(() => customInput.current?.focus())
  }

  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || sending) return
    if (event.key === "Escape") {
      event.preventDefault()
      dismiss()
      return
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "Enter") {
      event.preventDefault()
      next()
    }
  }

  if (question === undefined) return null
  const total = data.request.questions.length
  const multi = question.multiple === true
  const allowCustom = question.custom !== false

  return (
    <article
      className={`event-node question-node${sending ? " question-node--running" : ""}`}
      onKeyDown={handleKeys}
    >
      <Handle id="timeline-target" type="target" position={Position.Left} />
      <header className="question-node__header">
        <div>
          <span>{question.header}</span>
          <strong>{total > 1 ? `Question ${index + 1} of ${total}` : "Question"}</strong>
        </div>
        {total > 1 ? (
          <div className="question-node__progress" aria-label={`Question ${index + 1} of ${total}`}>
            {data.request.questions.map((_, questionIndex) => (
              <button
                key={questionIndex}
                type="button"
                aria-label={`Go to question ${questionIndex + 1}`}
                aria-current={questionIndex === index ? "step" : undefined}
                data-active={questionIndex === index}
                data-answered={draftIsAnswered(drafts[questionIndex])}
                disabled={sending}
                onClick={() => setIndex(questionIndex)}
              />
            ))}
          </div>
        ) : null}
      </header>

      <p className="question-node__text nodrag nopan">{question.question}</p>
      <p className="question-node__hint nodrag nopan">
        {multi ? "Select one or more options" : "Select one option"}
      </p>

      <div className="question-node__options" role={multi ? "group" : "radiogroup"}>
        {question.options.map((option, optionIndex) => {
          const picked = draft?.selectedOptions.includes(option.label) ?? false
          return (
            <button
              key={`${option.label}:${optionIndex}`}
              ref={(element) => {
                optionRefs.current[optionIndex] = element
              }}
              type="button"
              className="question-node__option nodrag nopan"
              role={multi ? "checkbox" : "radio"}
              aria-checked={picked}
              data-picked={picked}
              disabled={sending}
              onClick={() => select(option.label)}
            >
              <span className="question-node__mark" data-multiple={multi} aria-hidden="true" />
              <span>
                <strong>{option.label}</strong>
                {option.description === "" ? null : <small>{option.description}</small>}
              </span>
            </button>
          )
        })}

        {allowCustom ? (
          <div className="question-node__custom" data-active={draft?.customEnabled === true}>
            <button
              ref={customButton}
              type="button"
              className="question-node__option nodrag nopan"
              role={multi ? "checkbox" : "radio"}
              aria-checked={draft?.customEnabled === true}
              data-picked={draft?.customEnabled === true}
              disabled={sending}
              onClick={activateCustom}
            >
              <span className="question-node__mark" data-multiple={multi} aria-hidden="true" />
              <span>
                <strong>Type your own answer</strong>
                <small>{draft?.customText.trim() || "Enter a custom response"}</small>
              </span>
            </button>
            {draft?.customEnabled === true ? (
              <textarea
                ref={customInput}
                className="question-node__custom-input nodrag nopan nowheel"
                aria-label="Custom answer"
                rows={2}
                value={draft.customText}
                disabled={sending}
                placeholder="Type your answer"
                onChange={(event) => {
                  const value = event.target.value
                  setDrafts((current) => setCustomAnswer(current, index, value))
                  if (submission._tag === "Error") setSubmission({ _tag: "Idle" })
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.metaKey &&
                    !event.ctrlKey
                  ) {
                    event.preventDefault()
                    if (index >= total - 1) submit()
                    else setIndex((current) => current + 1)
                  }
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="question-node__footer">
        <button
          type="button"
          className="question-node__dismiss nodrag nopan"
          disabled={sending}
          onClick={dismiss}
        >
          Dismiss
        </button>
        <div>
          {index > 0 ? (
            <button
              type="button"
              className="question-node__back nodrag nopan"
              disabled={sending}
              onClick={() => setIndex((current) => current - 1)}
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            className="question-node__submit nodrag nopan"
            disabled={sending}
            onClick={next}
          >
            {index >= total - 1 ? "Submit" : "Next"}
          </button>
        </div>
      </footer>

      {submission._tag === "Error" ? (
        <p className="question-node__error" role="alert">
          {submission.message}
        </p>
      ) : null}
    </article>
  )
}
