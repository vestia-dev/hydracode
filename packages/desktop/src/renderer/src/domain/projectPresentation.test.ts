import { expect, it } from "@effect/vitest"
import { Project } from "@opencode-ai/client/effect"
import { Effect } from "effect"
import { projectDisplayName, projectInitial } from "./projectPresentation"

it.effect("falls back to the directory for missing and blank project names", () =>
  Effect.sync(() => {
    expect(projectDisplayName(undefined, "/code/vestia")).toBe("vestia")
    expect(projectDisplayName("  ", "/code/vestia")).toBe("vestia")
    expect(projectDisplayName(" Vestia ", "/code/vestia")).toBe("Vestia")
    expect(projectDisplayName(undefined, "/", Project.ID.global)).toBe("Global")
  }),
)

it.effect("uses the first letter or number for project initials", () =>
  Effect.sync(() => {
    expect(projectInitial(".config")).toBe("C")
    expect(projectInitial("-- 42 tools")).toBe("4")
    expect(projectInitial("HydraCode")).toBe("H")
  }),
)
