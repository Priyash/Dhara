import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUploadNotifier } from '../hooks/useUploadNotifier'

describe('useUploadNotifier', () => {
  let originalNotification

  beforeEach(() => {
    originalNotification = window.Notification
  })

  afterEach(() => {
    window.Notification = originalNotification
    vi.restoreAllMocks()
  })

  it('does not toast on first sighting of a job (no previous status)', () => {
    const onToast = vi.fn()
    const { result } = renderHook(() => useUploadNotifier(onToast))

    act(() => result.current.checkTransitions([{ _id: 'j1', status: 'queued', title: 'Film A' }]))
    expect(onToast).not.toHaveBeenCalled()
  })

  it('toasts success when a job transitions to ready', () => {
    const onToast = vi.fn()
    const { result } = renderHook(() => useUploadNotifier(onToast))

    act(() => result.current.checkTransitions([{ _id: 'j1', status: 'processing', title: 'Film A' }]))
    act(() => result.current.checkTransitions([{ _id: 'j1', status: 'ready', title: 'Film A' }]))

    expect(onToast).toHaveBeenCalledWith({ type: 'success', message: '"Film A" is ready to stream.' })
  })

  it('toasts error when a job transitions to failed, including the error message', () => {
    const onToast = vi.fn()
    const { result } = renderHook(() => useUploadNotifier(onToast))

    act(() => result.current.checkTransitions([{ _id: 'j1', status: 'processing', title: 'Film A' }]))
    act(() => result.current.checkTransitions([{ _id: 'j1', status: 'failed', title: 'Film A', error: 'Encode error' }]))

    expect(onToast).toHaveBeenCalledWith({ type: 'error', message: '"Film A" upload failed. Encode error' })
  })

  it('does not toast when status is unchanged across polls', () => {
    const onToast = vi.fn()
    const { result } = renderHook(() => useUploadNotifier(onToast))

    act(() => result.current.checkTransitions([{ _id: 'j1', status: 'processing', title: 'Film A' }]))
    act(() => result.current.checkTransitions([{ _id: 'j1', status: 'processing', title: 'Film A' }]))

    expect(onToast).not.toHaveBeenCalled()
  })

  it('tracks multiple jobs independently', () => {
    const onToast = vi.fn()
    const { result } = renderHook(() => useUploadNotifier(onToast))

    act(() => result.current.checkTransitions([
      { _id: 'j1', status: 'processing', title: 'Film A' },
      { _id: 'j2', status: 'processing', title: 'Film B' },
    ]))
    act(() => result.current.checkTransitions([
      { _id: 'j1', status: 'ready', title: 'Film A' },
      { _id: 'j2', status: 'failed', title: 'Film B', error: '' },
    ]))

    expect(onToast).toHaveBeenCalledTimes(2)
    expect(onToast).toHaveBeenCalledWith({ type: 'success', message: '"Film A" is ready to stream.' })
    expect(onToast).toHaveBeenCalledWith({ type: 'error', message: '"Film B" upload failed. ' })
  })

  it('sends a browser notification on ready when the tab is hidden', () => {
    const NotificationMock = vi.fn()
    NotificationMock.permission = 'granted'
    window.Notification = NotificationMock
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })

    const { result } = renderHook(() => useUploadNotifier(vi.fn()))
    act(() => result.current.checkTransitions([{ _id: 'j1', status: 'processing', title: 'Film A' }]))
    act(() => result.current.checkTransitions([{ _id: 'j1', status: 'ready', title: 'Film A' }]))

    expect(NotificationMock).toHaveBeenCalledWith('Upload complete ✓', expect.objectContaining({ body: '"Film A" is ready to stream.' }))

    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  })

  it('does not throw when Notification API is unavailable', () => {
    delete window.Notification
    const { result } = renderHook(() => useUploadNotifier(vi.fn()))
    expect(() => act(() => result.current.requestPermission())).not.toThrow()
  })

  it('requestPermission requests when permission is "default"', () => {
    const requestPermission = vi.fn()
    const NotificationMock = vi.fn()
    NotificationMock.permission = 'default'
    NotificationMock.requestPermission = requestPermission
    window.Notification = NotificationMock

    const { result } = renderHook(() => useUploadNotifier(vi.fn()))
    act(() => result.current.requestPermission())
    expect(requestPermission).toHaveBeenCalled()
  })
})
