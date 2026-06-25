import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';
import { useToast } from './useToast';

describe('useToast', () => {
  it('exposes success, error, and promise functions', () => {
    const { result } = renderHook(() => useToast());
    expect(typeof result.current.success).toBe('function');
    expect(typeof result.current.error).toBe('function');
    expect(typeof result.current.promise).toBe('function');
  });

  it('delegates success to sonner toast.success', () => {
    const spy = vi.spyOn(toast, 'success').mockImplementation(() => 'id');
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.success('Saved');
    });
    expect(spy).toHaveBeenCalledWith('Saved');
    spy.mockRestore();
  });

  it('delegates error to sonner toast.error', () => {
    const spy = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.error('Failed');
    });
    expect(spy).toHaveBeenCalledWith('Failed');
    spy.mockRestore();
  });

  it('delegates promise to sonner toast.promise', () => {
    const spy = vi.spyOn(toast, 'promise').mockImplementation(() => 'id' as never);
    const { result } = renderHook(() => useToast());
    const p = Promise.resolve('done');
    act(() => {
      result.current.promise(p, {
        loading: 'Loading',
        success: 'Done',
        error: 'Err',
      });
    });
    expect(spy).toHaveBeenCalledWith(p, {
      loading: 'Loading',
      success: 'Done',
      error: 'Err',
    });
    spy.mockRestore();
  });
});
