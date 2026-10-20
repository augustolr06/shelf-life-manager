import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useValorComAtraso } from './useValorComAtraso'

describe('useValorComAtraso (T26)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('começa com o valor inicial, sem esperar o atraso', () => {
    const { result } = renderHook(() => useValorComAtraso('perfume', 300))

    expect(result.current).toBe('perfume')
  })

  it('só entrega o valor novo depois do atraso', () => {
    const { result, rerender } = renderHook(({ valor }) => useValorComAtraso(valor, 300), {
      initialProps: { valor: '' },
    })

    rerender({ valor: 'per' })
    act(() => vi.advanceTimersByTime(299))
    expect(result.current).toBe('')

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('per')
  })

  it('cada mudança reinicia a contagem e só a última chega', () => {
    const { result, rerender } = renderHook(({ valor }) => useValorComAtraso(valor, 300), {
      initialProps: { valor: '' },
    })

    rerender({ valor: 'p' })
    act(() => vi.advanceTimersByTime(200))
    rerender({ valor: 'pe' })
    act(() => vi.advanceTimersByTime(200))
    rerender({ valor: 'per' })
    act(() => vi.advanceTimersByTime(200))

    // 600 ms desde a primeira tecla, mas nenhuma pausa de 300 ms: nada chegou.
    expect(result.current).toBe('')

    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('per')
  })

  it('usa 300 ms quando o atraso não é informado', () => {
    const { result, rerender } = renderHook(({ valor }) => useValorComAtraso(valor), {
      initialProps: { valor: 'a' },
    })

    rerender({ valor: 'b' })
    act(() => vi.advanceTimersByTime(299))
    expect(result.current).toBe('a')

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('b')
  })
})
