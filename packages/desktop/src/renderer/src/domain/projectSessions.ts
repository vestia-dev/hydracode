export interface SessionRelation<ID extends string> {
  readonly id: ID
  readonly parentID?: ID | null | undefined
}

function rootID<ID extends string>(
  session: SessionRelation<ID>,
  sessionsByID: ReadonlyMap<ID, SessionRelation<ID>>,
) {
  let current = session
  const seen = new Set([current.id])
  while (current.parentID != null) {
    const parent = sessionsByID.get(current.parentID)
    if (parent === undefined || seen.has(parent.id)) break
    seen.add(parent.id)
    current = parent
  }
  return current.id
}

export function visibleSessionFamily<ID extends string, T extends SessionRelation<ID>>(
  sessions: ReadonlyArray<T>,
  activeIDs: ReadonlySet<string>,
) {
  const sessionsByID = new Map(sessions.map((session) => [session.id, session] as const))
  const activeRoots = new Set(
    sessions
      .filter((session) => activeIDs.has(session.id))
      .map((session) => rootID(session, sessionsByID)),
  )
  const selectedRoots =
    activeRoots.size > 0
      ? activeRoots
      : new Set(sessions[0] === undefined ? [] : [rootID(sessions[0], sessionsByID)])

  return sessions.filter((session) => selectedRoots.has(rootID(session, sessionsByID)))
}

export interface SessionFamily<T> {
  readonly root: T
  readonly descendants: ReadonlyArray<T>
}

export function groupSessionFamilies<ID extends string, T extends SessionRelation<ID>>(
  sessions: ReadonlyArray<T>,
) {
  const sessionsByID = new Map(sessions.map((session) => [session.id, session] as const))
  const families = new Map<ID, { root: T; descendants: Array<T> }>()

  for (const session of sessions) {
    const id = rootID(session, sessionsByID)
    const root = sessionsByID.get(id)
    if (root === undefined) continue
    const family = families.get(id) ?? { root, descendants: [] }
    if (session.id !== id) family.descendants.push(session)
    families.set(id, family)
  }

  return Array.from(families.values()) satisfies ReadonlyArray<SessionFamily<T>>
}

export interface SubagentLauncher {
  readonly id: string
  readonly created: number
  readonly sessionIDs: ReadonlyArray<string>
}

export interface SubagentSession {
  readonly id: string
  readonly created: number
}

export function matchSubagentLaunchers(
  children: ReadonlyArray<SubagentSession>,
  launchers: ReadonlyArray<SubagentLauncher>,
) {
  const matches = new Map<string, string>()
  const available = new Set(launchers.map((launcher) => launcher.id))
  const orderedChildren = children.toSorted((left, right) => left.created - right.created)

  for (const child of orderedChildren) {
    const exact = launchers.find(
      (launcher) => available.has(launcher.id) && launcher.sessionIDs.includes(child.id),
    )
    const launcher =
      exact ??
      launchers
        .filter((candidate) => available.has(candidate.id) && candidate.created <= child.created)
        .toSorted((left, right) => right.created - left.created)[0]
    if (launcher === undefined) continue
    matches.set(child.id, launcher.id)
    available.delete(launcher.id)
  }

  return matches
}
