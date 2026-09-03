import { describe, expect, test } from 'bun:test'
import { createEventBus } from '../src/events/bus'
import { type EventPayload, STANDARD_EVENTS } from '../src/events/types'

describe('Typed EventBus', () => {
  test('matches exact events and invokes handlers', async () => {
    const bus = createEventBus()
    const received: EventPayload[] = []

    bus.on(STANDARD_EVENTS.USERS_CREATE, (payload) => {
      received.push(payload)
    })

    const payload: EventPayload = {
      event: STANDARD_EVENTS.USERS_CREATE,
      projectId: 'proj_1',
      timestamp: new Date().toISOString(),
      data: { userId: 'u_1', name: 'Alice' },
    }

    await bus.emit(payload)
    expect(received).toHaveLength(1)
    expect(received[0]?.data).toEqual({ userId: 'u_1', name: 'Alice' })
  })

  test('matches wildcard patterns and multiple listeners', async () => {
    const bus = createEventBus()
    let wildcardCalls = 0
    let globalCalls = 0
    let exactCalls = 0

    bus.on('storage.*', () => {
      wildcardCalls++
    })
    bus.on('*', () => {
      globalCalls++
    })
    bus.on(STANDARD_EVENTS.USERS_CREATE, () => {
      exactCalls++
    })

    await bus.emit({
      event: STANDARD_EVENTS.BUCKETS_CREATE,
      projectId: 'proj_1',
      timestamp: new Date().toISOString(),
      data: { bucketId: 'b_1' },
    })

    expect(wildcardCalls).toBe(1)
    expect(globalCalls).toBe(1)
    expect(exactCalls).toBe(0)
  })

  test('once() listener unsubscribes after first match', async () => {
    const bus = createEventBus()
    let count = 0

    bus.once('users.*', () => {
      count++
    })

    await bus.emit({
      event: STANDARD_EVENTS.USERS_CREATE,
      projectId: 'p_1',
      timestamp: new Date().toISOString(),
      data: {},
    })
    await bus.emit({
      event: STANDARD_EVENTS.USERS_UPDATE,
      projectId: 'p_1',
      timestamp: new Date().toISOString(),
      data: {},
    })

    expect(count).toBe(1)
    expect(bus.listenerCount()).toBe(0)
  })

  test('unsubscribe function removes listener', async () => {
    const bus = createEventBus()
    let count = 0

    const unsubscribe = bus.on('test.event', () => {
      count++
    })

    await bus.emit({
      event: 'test.event',
      projectId: 'p_1',
      timestamp: new Date().toISOString(),
      data: {},
    })
    expect(count).toBe(1)

    unsubscribe()

    await bus.emit({
      event: 'test.event',
      projectId: 'p_1',
      timestamp: new Date().toISOString(),
      data: {},
    })
    expect(count).toBe(1)
  })

  test('error isolation: failing listener reports to onError without throwing', async () => {
    const errors: unknown[] = []
    const bus = createEventBus({
      onError: (err) => errors.push(err),
    })

    let secondListenerRan = false

    bus.on('fail.event', () => {
      throw new Error('Listener error')
    })
    bus.on('fail.event', () => {
      secondListenerRan = true
    })

    await bus.emit({
      event: 'fail.event',
      projectId: 'p_1',
      timestamp: new Date().toISOString(),
      data: {},
    })

    expect(secondListenerRan).toBe(true)
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('Listener error')
  })
})
