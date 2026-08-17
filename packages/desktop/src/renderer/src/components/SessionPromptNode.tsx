import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { Effect, Fiber } from "effect"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { AppRuntime } from "../runtime"
import { recordStartupMeasure } from "../startupTiming"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import { IconButton } from "./IconButton"
import type { PendingPrompt } from "../services/OpenCodeGateway"

type SubmissionState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Submitting" }
  | { readonly _tag: "Error" }

const initialSubmissionState: SubmissionState = { _tag: "Idle" }

export interface SessionPromptNodeData extends Record<string, unknown> {
  readonly agentRunning: boolean
  readonly submitPrompt: (
    text: string,
    delivery?: "queue" | "steer",
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly pendingPrompts: ReadonlyArray<PendingPrompt>
  readonly updatePendingPrompt: (
    inboxID: PendingPrompt["id"],
    action: "cancel" | "queue" | "steer",
  ) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly retryPrompt?: { readonly text: string; readonly message: string }
  readonly focusRequest?: number
  readonly draft: string
  readonly setDraft: (draft: string) => void
}

export type SessionPromptFlowNode = Node<SessionPromptNodeData, "sessionPrompt">

export function SessionPromptNode({ data }: NodeProps<SessionPromptFlowNode>) {
  const { agentRunning, submitPrompt } = data
  const [text, setText] = useState(data.draft)
  const [submission, setSubmission] = useState<SubmissionState>(initialSubmissionState)
  const appliedRetry = useRef<typeof data.retryPrompt>(undefined)
  const submissionFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const promptInput = useRef<HTMLTextAreaElement>(null)
  const sendDisabled = submission._tag === "Submitting"

  useEffect(() => {
    if (data.retryPrompt === undefined || appliedRetry.current === data.retryPrompt) return
    appliedRetry.current = data.retryPrompt
    setText(data.retryPrompt.text)
    data.setDraft(data.retryPrompt.text)
    setSubmission({ _tag: "Error" })
  }, [data.retryPrompt])

  const submit = useCallback(
    (delivery?: "queue" | "steer") => {
      const prompt = text.trim()
      if (prompt === "" || submission._tag === "Submitting" || sendDisabled) return

      const previousFiber = submissionFiber.current
      if (previousFiber !== null) AppRuntime.runFork(Fiber.interrupt(previousFiber))
      setSubmission({ _tag: "Submitting" })
      setText("")
      data.setDraft("")

      const submitted =
        delivery === undefined ? submitPrompt(prompt) : submitPrompt(prompt, delivery)
      const program = submitted.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setSubmission(initialSubmissionState)
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setText(prompt)
            data.setDraft(prompt)
            setSubmission({ _tag: "Error" })
          }),
        ),
      )
      submissionFiber.current = AppRuntime.runFork(program)
    },
    [sendDisabled, submission._tag, submitPrompt, text],
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

  useEffect(() => {
    if (data.focusRequest === undefined) return
    promptInput.current?.focus({ preventScroll: true })
  }, [data.focusRequest])

  useLayoutEffect(() => {
    const input = promptInput.current
    if (input === null) return
    const started = performance.now()
    input.style.height = "auto"
    const scrollHeight = input.scrollHeight
    input.style.height = `${String(scrollHeight)}px`
    recordStartupMeasure("prompt-autosize-layout", started, { scrollHeight })
  }, [text])

  return (
    <article
      className={`event-node prompt-node${agentRunning || sendDisabled ? " prompt-node--loading" : ""}`}
    >
      <Handle id="timeline-target" type="target" position={Position.Left} />
      {data.pendingPrompts.length === 0 ? null : (
        <div className="prompt-node__inbox nodrag nopan nowheel" aria-label="Pending prompts">
          {data.pendingPrompts.map((prompt) => (
            <div className="prompt-node__inbox-item" key={prompt.id}>
              <span className="prompt-node__inbox-text" title={prompt.text}>
                {prompt.text}
              </span>
              <span className="prompt-node__inbox-mode">{prompt.delivery}</span>
              <button
                type="button"
                onClick={() =>
                  AppRuntime.runFork(
                    data
                      .updatePendingPrompt(
                        prompt.id,
                        prompt.delivery === "queue" ? "steer" : "queue",
                      )
                      .pipe(Effect.ignore),
                  )
                }
              >
                {prompt.delivery === "queue" ? "Steer" : "Queue"}
              </button>
              <button
                type="button"
                onClick={() =>
                  AppRuntime.runFork(
                    data.updatePendingPrompt(prompt.id, "cancel").pipe(Effect.ignore),
                  )
                }
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit("steer")
        }}
      >
        <textarea
          ref={promptInput}
          className="prompt-node__input nodrag nopan nowheel"
          aria-label="Prompt the agent"
          rows={2}
          value={text}
          placeholder="What should the agent do next?"
          onChange={(event) => {
            setText(event.target.value)
            data.setDraft(event.target.value)
            if (submission._tag === "Error") setSubmission(initialSubmissionState)
          }}
          onKeyDown={submitOnEnter}
        />
        <IconButton
          className="prompt-node__send nodrag nopan"
          type="submit"
          label="Send prompt"
          variant="filled"
          disabled={sendDisabled || text.trim() === ""}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
          </svg>
        </IconButton>
        <IconButton
          className="prompt-node__queue nodrag nopan"
          type="button"
          label="Queue prompt"
          variant="ghost"
          disabled={sendDisabled || text.trim() === ""}
          onClick={() => submit("queue")}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 5.5h7.5M6.5 2.5l3 3-3 3M14.25 11a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0ZM11 9.25V11l1.25 1" />
          </svg>
        </IconButton>
      </form>
    </article>
  )
}
