import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import type { Question } from "@opencode-ai/client/effect"
import { Effect, Fiber } from "effect"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { AppRuntime } from "../runtime"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"

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

const emptyAnswers = (request: Question.Request) => request.questions.map(() => [] as string[])
const emptyCustom = (request: Question.Request) => request.questions.map(() => "")
const emptyCustomActive = (request: Question.Request) => request.questions.map(() => false)

export function SessionQuestionNode({ data }: NodeProps<SessionQuestionFlowNode>) {
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState(() => emptyAnswers(data.request))
  const [custom, setCustom] = useState(() => emptyCustom(data.request))
  const [customActive, setCustomActive] = useState(() => emptyCustomActive(data.request))
  const [submission, setSubmission] = useState<SubmissionState>({ _tag: "Idle" })
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const customButton = useRef<HTMLButtonElement>(null)
  const customInput = useRef<HTMLTextAreaElement>(null)
  const submissionFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const requestID = data.request.id
  const question = data.request.questions[index]
  const sending = submission._tag === "Replying" || submission._tag === "Rejecting"

  useEffect(() => {
    setIndex(0)
    setSelected(emptyAnswers(data.request))
    setCustom(emptyCustom(data.request))
    setCustomActive(emptyCustomActive(data.request))
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
    const target = customActive[index]
      ? (customInput.current ?? customButton.current)
      : (optionRefs.current[0] ?? customButton.current)
    target?.focus({ preventScroll: true })
  }, [customActive, data.focusRequest, index, sending])

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

  const answers = useCallback(
    () =>
      data.request.questions.map((_, questionIndex) => {
        const answer = selected[questionIndex] ?? []
        const own = customActive[questionIndex] ? (custom[questionIndex] ?? "").trim() : ""
        return own === "" || answer.includes(own) ? answer : [...answer, own]
      }),
    [custom, customActive, data.request.questions, selected],
  )

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
    setSelected((current) =>
      current.map((answer, questionIndex) => {
        if (questionIndex !== index) return answer
        if (question.multiple === true)
          return answer.includes(label)
            ? answer.filter((item) => item !== label)
            : [...answer, label]
        return [label]
      }),
    )
    if (question.multiple !== true) {
      setCustomActive((current) => current.map((active, i) => (i === index ? false : active)))
    }
  }

  const activateCustom = () => {
    if (question === undefined || sending) return
    setSubmission({ _tag: "Idle" })
    setCustomActive((current) =>
      current.map((active, i) =>
        i === index ? (question.multiple === true ? !active : true) : active,
      ),
    )
    if (question.multiple !== true) {
      setSelected((current) => current.map((answer, i) => (i === index ? [] : answer)))
    }
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
                data-answered={
                  (selected[questionIndex]?.length ?? 0) > 0 ||
                  (customActive[questionIndex] && (custom[questionIndex] ?? "").trim() !== "")
                }
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
          const picked = selected[index]?.includes(option.label) ?? false
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
          <div className="question-node__custom" data-active={customActive[index]}>
            <button
              ref={customButton}
              type="button"
              className="question-node__option nodrag nopan"
              role={multi ? "checkbox" : "radio"}
              aria-checked={customActive[index]}
              data-picked={customActive[index]}
              disabled={sending}
              onClick={activateCustom}
            >
              <span className="question-node__mark" data-multiple={multi} aria-hidden="true" />
              <span>
                <strong>Type your own answer</strong>
                <small>{custom[index]?.trim() || "Enter a custom response"}</small>
              </span>
            </button>
            {customActive[index] ? (
              <textarea
                ref={customInput}
                className="question-node__custom-input nodrag nopan nowheel"
                aria-label="Custom answer"
                rows={2}
                value={custom[index] ?? ""}
                disabled={sending}
                placeholder="Type your answer"
                onChange={(event) => {
                  const value = event.target.value
                  setCustom((current) => current.map((answer, i) => (i === index ? value : answer)))
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
