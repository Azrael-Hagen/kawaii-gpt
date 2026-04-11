import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetCloudCircuitRandomForTests,
  __setCloudCircuitRandomForTests,
  getCloudProviderCircuitDecision,
  markCloudProviderFailure,
  markCloudProviderSuccess,
  resetCloudCircuitBreaker,
} from '@/services/cloudCircuitBreaker'

describe('cloudCircuitBreaker', () => {
  afterEach(() => {
    resetCloudCircuitBreaker()
    __resetCloudCircuitRandomForTests()
  })

  it('opens after repeated transient failures and then half-opens', () => {
    __setCloudCircuitRandomForTests(() => 0)
    const baseUrl = 'https://api.example.com/v1'

    markCloudProviderFailure(baseUrl, 'Provider timeout', 10_000)
    let decision = getCloudProviderCircuitDecision(baseUrl, 10_001)
    expect(decision.allowed).toBe(true)

    markCloudProviderFailure(baseUrl, 'fetch failed timeout', 10_100)
    decision = getCloudProviderCircuitDecision(baseUrl, 10_200)
    expect(decision.allowed).toBe(false)
    expect(decision.state).toBe('open')
    expect(decision.retryInMs).toBeGreaterThan(0)

    const afterWindow = 22_500
    const probe = getCloudProviderCircuitDecision(baseUrl, afterWindow)
    expect(probe.allowed).toBe(true)
    expect(probe.state).toBe('half-open')
  })

  it('respects retry-after hints for throttling failures', () => {
    __setCloudCircuitRandomForTests(() => 0)
    const baseUrl = 'https://api.rate-limited.com/v1'

    markCloudProviderFailure(baseUrl, 'Provider error (429): Slow Down. retry-after: 45', 1_000)
    markCloudProviderFailure(baseUrl, 'Provider error (429): Slow Down. retry-after: 45', 1_100)

    const blocked = getCloudProviderCircuitDecision(baseUrl, 20_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.state).toBe('open')
    expect(blocked.retryInMs).toBeGreaterThan(20_000)

    const probe = getCloudProviderCircuitDecision(baseUrl, 46_500)
    expect(probe.allowed).toBe(true)
    expect(probe.state).toBe('half-open')
  })

  it('closes after two successful half-open probes', () => {
    __setCloudCircuitRandomForTests(() => 0)
    const baseUrl = 'https://api.recovery.com/v1'

    markCloudProviderFailure(baseUrl, 'Provider timeout', 5_000)
    markCloudProviderFailure(baseUrl, 'Provider timeout', 5_100)

    const firstProbe = getCloudProviderCircuitDecision(baseUrl, 18_000)
    expect(firstProbe.allowed).toBe(true)
    expect(firstProbe.state).toBe('half-open')
    markCloudProviderSuccess(baseUrl)

    const secondProbe = getCloudProviderCircuitDecision(baseUrl, 18_200)
    expect(secondProbe.allowed).toBe(true)
    expect(secondProbe.state).toBe('half-open')
    markCloudProviderSuccess(baseUrl)

    const healthy = getCloudProviderCircuitDecision(baseUrl, 18_300)
    expect(healthy.allowed).toBe(true)
    expect(healthy.state).toBe('closed')
    expect(healthy.reason).toBe('closed')
  })
})
