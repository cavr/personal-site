---
title: "From Redux Saga to 5 Lines: A Honest Look at Modern React State Management"
description: |
  Staring at a saga with three levels of generator nesting just to handle login.
  Most of that complexity was self-inflicted. Here's what replaced it.
publishDate: 2026-03-14 00:00:00
tags:
  - React
  - Frontend
  - Architecture
  - Engineering
---

There's a rite of passage in React development where you find yourself staring at a saga file with three levels of generator nesting, a `takeLatest`, two `forks`, and a `channel` — all just to handle login. You tell yourself this is the right way. You've seen it in every enterprise codebase. It must be necessary.

It isn't. At least not for most of what we use it for.

## The auth saga we were all taught to write

Redux Saga auth flows were everywhere circa 2018. A watcher saga, a worker saga, token refresh logic, a channel for intercepting 401s, redirects on logout. It felt robust. It felt serious. Auth is serious, after all.

But let's walk through what each piece of that saga was actually solving and whether we still need it.

**Token storage and transport** — solved by an HttpOnly cookie. The browser attaches it automatically. No saga needed.

**CSRF protection** — solved by SameSite=Strict on the cookie. Not CORS, which is a common misconception. CORS controls who can read responses, not who can trigger requests with your cookies attached.

**401 handling and redirect** — solved by a fetch wrapper:

```ts
const apiFetch = (...[url, options]: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
  fetch(url, { credentials: 'include', ...options })
    .then(res => res.status === 401
      ? (window.location.href = '/login') as never
      : res)
```

That's it. Same signature as fetch, fully type-safe, drop-in replacement.

**Loading and error state** — solved by React Query's `useMutation`. One hook, done.

**Logout** — a POST to your logout endpoint clears the cookie server-side. The client redirects. One line.

The honest conclusion is that a well-architected cookie-based app with a fetch wrapper and React Query doesn't need a saga for auth at all. The complexity we were managing with sagas was largely self-inflicted by storing JWTs in localStorage and managing token refresh on the client.

## So where do sagas actually earn their keep?

Real-time applications. That's the honest answer.

A WebSocket connection is inherently long-running and stateful. It needs to be opened, kept alive, reconnected on failure with exponential backoff, and cleanly torn down on logout. It emits a continuous stream of events that need to be converted into application state. Multiple streams — messages, presence, typing indicators, notifications — need to run concurrently without blocking each other.

This is exactly the problem sagas were designed for. `fork` spawns concurrent tasks without blocking. `cancel` tears them down cleanly. `eventChannel` converts a WebSocket into a stream of Redux actions. `spawn` runs non-critical tasks in isolation so a crash in presence detection doesn't kill your message listener.

But there's a catch that doesn't get talked about enough: **unhandled errors in sagas crash the entire saga tree silently**. A worker inside a `while(true)` loop that throws without a try/catch stops processing forever with no warning. In production, after the first network hiccup, your real-time features just stop working. This is one of the most common bugs in saga-heavy codebases.

## The modern alternatives

**XState** is the strongest alternative for real-time flows. A WebSocket connection has explicit states — connecting, open, reconnecting, closed — and state machines model that naturally and visually. Sagas do it imperatively, XState does it declaratively.

**Zustand with inline socket management** co-locates your state and connection logic without any middleware ceremony:

```ts
const useStore = create((set, get) => ({
  messages: [],
  socket: null,
  retries: 0,

  connect: () => {
    const ws = new WebSocket('wss://api.example.com')
    ws.onopen = () => set({ retries: 0 })
    ws.onmessage = (e) => set(state => ({
      messages: [...state.messages, JSON.parse(e.data)]
    }))
    ws.onclose = () => {
      const { retries, connect } = get()
      const delay = Math.min(1000 * 2 ** retries, 30000)
      set(state => ({ retries: state.retries + 1 }))
      setTimeout(connect, delay)
    }
    set({ socket: ws })
  },

  disconnect: () => {
    get().socket?.close()
    set({ socket: null, retries: 0 })
  }
}))
```

Exponential backoff, reconnection, state updates — no generators, no channels, no boilerplate.

**React Query + WebSocket** is another pattern worth knowing. React Query owns the cache and handles the initial data fetch. The WebSocket pushes updates directly into that cache via `setQueryData`. Components read from the cache and don't care where the data came from.

**`useSyncExternalStore`** takes this further — no libraries at all. Build a plain JavaScript store with a subscribe function and a getSnapshot function, and React handles the re-renders:

```ts
const createSocketStore = () => {
  let messages: unknown[] = []
  let listeners = new Set<() => void>()
  let socket: WebSocket | null = null
  let retries = 0

  const notify = () => listeners.forEach(l => l())

  const connect = () => {
    socket = new WebSocket('wss://api.example.com')

    socket.onopen = () => { retries = 0; notify() }

    socket.onmessage = (e) => {
      messages = [...messages, JSON.parse(e.data)]
      notify()
    }

    socket.onclose = () => {
      const delay = Math.min(1000 * 2 ** retries++, 30000)
      setTimeout(connect, delay)
    }
  }

  connect()

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => messages,
  }
}

const socketStore = createSocketStore()

const useMessages = () =>
  useSyncExternalStore(
    socketStore.subscribe,
    socketStore.getSnapshot
  )
```

That's a fully reactive, concurrent-mode-safe subscription to a WebSocket with zero dependencies. Components just call `useMessages()` and re-render automatically when new data arrives.

## The takeaway

Redux Saga is a powerful tool that solved real problems at a specific moment in the React ecosystem. For auth flows, most of that complexity is now better handled by cookies, a typed fetch wrapper, and React Query. For real-time flows, sagas still have a strong case — but so do XState, Zustand, and even raw `useSyncExternalStore`.

The question worth asking before reaching for a saga isn't "how do I implement this pattern" but "what problem am I actually solving and what is the simplest thing that handles it." Sometimes that's a saga. More often these days, it's five lines of TypeScript.
