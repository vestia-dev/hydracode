import { describe, expect, it, vi } from "vitest"
import { makeProjectUpdateSubscriptions } from "./projectUpdateSubscriptions"

describe("project update subscriptions", () => {
  it("routes interleaved updates to the matching subscription", () => {
    const updates = makeProjectUpdateSubscriptions<string>()
    const first = vi.fn()
    const second = vi.fn()
    updates.subscribe("first", first)
    updates.subscribe("second", second)

    updates.publish("first", "first-1")
    updates.publish("second", "second-1")

    expect(first).toHaveBeenCalledExactlyOnceWith("first-1")
    expect(second).toHaveBeenCalledExactlyOnceWith("second-1")
  })

  it("replays a late subscription backlog once", () => {
    const updates = makeProjectUpdateSubscriptions<string>()
    updates.publish("project", "snapshot")
    updates.publish("project", "session")
    const first = vi.fn()
    const second = vi.fn()

    updates.subscribe("project", first)
    updates.subscribe("project", second)

    expect(first.mock.calls).toEqual([["snapshot"], ["session"]])
    expect(second).not.toHaveBeenCalled()
  })

  it("clears pending updates when a subscription closes", () => {
    const updates = makeProjectUpdateSubscriptions<string>()
    updates.publish("project", "stale")
    updates.clear("project")
    const listener = vi.fn()

    updates.subscribe("project", listener)

    expect(listener).not.toHaveBeenCalled()
  })

  it("bounds pending updates per subscription", () => {
    const updates = makeProjectUpdateSubscriptions<string>(2)
    updates.publish("project", "oldest")
    updates.publish("project", "middle")
    updates.publish("project", "latest")
    const listener = vi.fn()

    updates.subscribe("project", listener)

    expect(listener.mock.calls).toEqual([["middle"], ["latest"]])
  })
})
