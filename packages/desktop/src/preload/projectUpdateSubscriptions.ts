export function makeProjectUpdateSubscriptions<A>(maxPending = 512) {
  const listeners = new Map<string, Set<(update: A) => void>>()
  const pending = new Map<string, Array<A>>()

  const publish = (subscriptionID: string, update: A) => {
    const subscriptionListeners = listeners.get(subscriptionID)
    if (subscriptionListeners !== undefined && subscriptionListeners.size > 0) {
      for (const listener of subscriptionListeners) listener(update)
      return
    }
    const updates = pending.get(subscriptionID) ?? []
    updates.push(update)
    if (updates.length > maxPending) updates.shift()
    pending.set(subscriptionID, updates)
  }

  const subscribe = (subscriptionID: string, listener: (update: A) => void) => {
    const subscriptionListeners = listeners.get(subscriptionID) ?? new Set()
    subscriptionListeners.add(listener)
    listeners.set(subscriptionID, subscriptionListeners)
    for (const update of pending.get(subscriptionID) ?? []) listener(update)
    pending.delete(subscriptionID)
    return () => {
      subscriptionListeners.delete(listener)
      if (subscriptionListeners.size === 0) listeners.delete(subscriptionID)
    }
  }

  const clear = (subscriptionID: string) => {
    listeners.delete(subscriptionID)
    pending.delete(subscriptionID)
  }

  return { publish, subscribe, clear } as const
}
