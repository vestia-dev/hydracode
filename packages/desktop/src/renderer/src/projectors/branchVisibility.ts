export function toggleBranchVisibility(
  hiddenBranches: ReadonlySet<string>,
  branchID: string,
  siblingIDs: ReadonlyArray<string>,
): ReadonlySet<string> {
  const next = new Set(hiddenBranches)
  if (next.has(branchID)) {
    for (const siblingID of siblingIDs) next.add(siblingID)
    next.delete(branchID)
  } else {
    next.add(branchID)
  }
  return next
}

export function activateNewBranches(
  hiddenBranches: ReadonlySet<string>,
  knownBranchIDs: ReadonlySet<string>,
  branchGroups: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlySet<string> {
  const next = new Set(hiddenBranches)
  let changed = false
  for (const siblingIDs of branchGroups) {
    const newestBranchID = siblingIDs.findLast((branchID) => !knownBranchIDs.has(branchID))
    if (newestBranchID === undefined) continue
    changed = true
    for (const siblingID of siblingIDs) next.add(siblingID)
    next.delete(newestBranchID)
  }
  return changed ? next : hiddenBranches
}
