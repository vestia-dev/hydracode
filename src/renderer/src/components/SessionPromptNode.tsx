import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { Effect, Fiber } from "effect"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { AppRuntime } from "../runtime"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import { LoadingIndicator } from "./LoadingIndicator"

type SubmissionState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Submitting" }
  | { readonly _tag: "Submitted" }
  | { readonly _tag: "Error"; readonly message: string }

const initialSubmissionState: SubmissionState = { _tag: "Idle" }

export interface SessionPromptNodeData extends Record<string, unknown> {
  readonly agentRunning: boolean
  readonly promptPending: boolean
  readonly submitPrompt: (text: string) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly retryPrompt?: { readonly text: string; readonly message: string }
}

export type SessionPromptFlowNode = Node<SessionPromptNodeData, "sessionPrompt">

export function SessionPromptNode({ data }: NodeProps<SessionPromptFlowNode>) {
  const { agentRunning, promptPending, submitPrompt } = data
  const [text, setText] = useState("")
  const [submission, setSubmission] = useState<SubmissionState>(initialSubmissionState)
  const appliedRetry = useRef<typeof data.retryPrompt>(undefined)
  const sawRunning = useRef(false)
  const submissionFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const locked =
    agentRunning ||
    promptPending ||
    submission._tag === "Submitting" ||
    (submission._tag === "Submitted" && !sawRunning.current)

  useEffect(() => {
    if (agentRunning) sawRunning.current = true
    else if (sawRunning.current && submission._tag === "Submitted") {
      sawRunning.current = false
      setSubmission(initialSubmissionState)
    }
  }, [agentRunning, submission._tag])

  useEffect(() => {
    if (data.retryPrompt === undefined || appliedRetry.current === data.retryPrompt) return
    appliedRetry.current = data.retryPrompt
    setText(data.retryPrompt.text)
    setSubmission({ _tag: "Error", message: data.retryPrompt.message })
  }, [data.retryPrompt])

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const prompt = text.trim()
      if (prompt === "" || locked) return

      const previousFiber = submissionFiber.current
      if (previousFiber !== null) AppRuntime.runFork(Fiber.interrupt(previousFiber))
      setSubmission({ _tag: "Submitting" })
      sawRunning.current = false

      const program = submitPrompt(prompt).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setText("")
            setSubmission({ _tag: "Submitted" })
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => setSubmission({ _tag: "Error", message: error.message })),
        ),
      )
      submissionFiber.current = AppRuntime.runFork(program)
    },
    [locked, submitPrompt, text],
  )

  const submitOnEnter = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }, [])

  useEffect(
    () => () => {
      const fiber = submissionFiber.current
      if (fiber !== null) AppRuntime.runFork(Fiber.interrupt(fiber))
    },
    [],
  )

  const placeholder =
    agentRunning || promptPending
      ? "Agent is working…"
      : submission._tag === "Submitted"
        ? "Prompt sent…"
        : "What should the agent do next?"

  return (
    <article className={`event-node prompt-node${locked ? " prompt-node--loading" : ""}`}>
      <Handle id="timeline-target" type="target" position={Position.Left} />
      <form onSubmit={submit}>
        <textarea
          className="prompt-node__input nodrag nopan nowheel"
          aria-label="Prompt the agent"
          rows={2}
          value={text}
          disabled={locked}
          placeholder={placeholder}
          onChange={(event) => {
            setText(event.target.value)
            if (submission._tag === "Error") setSubmission(initialSubmissionState)
          }}
          onKeyDown={submitOnEnter}
        />
        <button
          className="prompt-node__send nodrag nopan"
          type="submit"
          aria-label="Send prompt"
          disabled={locked || text.trim() === ""}
        >
          {submission._tag === "Submitting" ? "Sending" : "Send"}
        </button>
      </form>
      {locked ? (
        <LoadingIndicator
          label={
            submission._tag === "Submitting" || promptPending ? "Sending prompt" : "Agent working"
          }
        />
      ) : null}
      {submission._tag === "Error" ? (
        <p className="prompt-node__error" role="alert">
          {submission.message}
        </p>
      ) : null}
    </article>
  )
}
