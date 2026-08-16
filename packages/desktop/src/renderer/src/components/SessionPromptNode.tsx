import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import { Effect, Fiber } from "effect"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { AppRuntime } from "../runtime"
import { recordStartupMeasure } from "../startupTiming"
import type { DesktopBridge, DesktopBridgeError } from "../services/DesktopBridge"
import { IconButton } from "./IconButton"

type SubmissionState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Submitting" }
  | { readonly _tag: "Submitted" }
  | { readonly _tag: "Error" }

const initialSubmissionState: SubmissionState = { _tag: "Idle" }

export interface SessionPromptNodeData extends Record<string, unknown> {
  readonly agentRunning: boolean
  readonly promptPending: boolean
  readonly submitPrompt: (text: string) => Effect.Effect<void, DesktopBridgeError, DesktopBridge>
  readonly retryPrompt?: { readonly text: string; readonly message: string }
  readonly focusRequest?: number
  readonly draft: string
  readonly setDraft: (draft: string) => void
}

export type SessionPromptFlowNode = Node<SessionPromptNodeData, "sessionPrompt">

export function SessionPromptNode({ data }: NodeProps<SessionPromptFlowNode>) {
  const { agentRunning, promptPending, submitPrompt } = data
  const [text, setText] = useState(data.draft)
  const [submission, setSubmission] = useState<SubmissionState>(initialSubmissionState)
  const appliedRetry = useRef<typeof data.retryPrompt>(undefined)
  const sawRunning = useRef(false)
  const submissionFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null)
  const promptInput = useRef<HTMLTextAreaElement>(null)
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
    data.setDraft(data.retryPrompt.text)
    setSubmission({ _tag: "Error" })
  }, [data.retryPrompt])

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const prompt = text.trim()
      if (prompt === "" || locked) return

      const previousFiber = submissionFiber.current
      if (previousFiber !== null) AppRuntime.runFork(Fiber.interrupt(previousFiber))
      setSubmission({ _tag: "Submitting" })
      setText("")
      data.setDraft("")
      sawRunning.current = false

      const program = submitPrompt(prompt).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setSubmission({ _tag: "Submitted" })
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

  useEffect(() => {
    if (data.focusRequest === undefined || locked) return
    promptInput.current?.focus({ preventScroll: true })
  }, [data.focusRequest, locked])

  useLayoutEffect(() => {
    const input = promptInput.current
    if (input === null) return
    const started = performance.now()
    input.style.height = "auto"
    const scrollHeight = input.scrollHeight
    input.style.height = `${String(scrollHeight)}px`
    recordStartupMeasure("prompt-autosize-layout", started, { scrollHeight })
  }, [text])

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
          ref={promptInput}
          className="prompt-node__input nodrag nopan nowheel"
          aria-label="Prompt the agent"
          rows={2}
          value={text}
          disabled={locked}
          placeholder={placeholder}
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
          disabled={locked || text.trim() === ""}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
          </svg>
        </IconButton>
      </form>
    </article>
  )
}
