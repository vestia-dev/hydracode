import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { toolLayoutFixtureGraph } from "./toolLayoutFixture"

it.effect("projects one tool list and one aggregate changes node", () =>
  Effect.sync(() => {
    const graph = toolLayoutFixtureGraph()
    const tools = graph.nodes.find((node) => node.kind === "round-tools")
    const artifacts = graph.nodes.find((node) => node.kind === "round-artifacts")

    expect(graph.nodes.map((node) => node.kind)).toEqual([
      "round",
      "round-tools",
      "round-artifacts",
    ])
    expect(tools?.roundTools?.calls).toHaveLength(8)
    expect(tools?.roundTools?.calls.filter((call) => call.diff)).toHaveLength(2)
    expect(artifacts?.roundArtifacts?.diff.files).toHaveLength(2)
    expect(graph.edges.map((edge) => edge.kind)).toEqual(["tools", "artifacts"])
  }),
)
