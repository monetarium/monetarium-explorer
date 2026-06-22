import { describe, it, expect } from 'vitest'
import { classifyGesture } from './touch_gesture'

describe('classifyGesture', () => {
  const T = 8

  it('horizontal movement past the threshold is a scrub', () => {
    expect(classifyGesture(30, 5, T)).toBe('scrub')
    expect(classifyGesture(-30, 5, T)).toBe('scrub') // sign-agnostic
  })

  it('vertical movement past the threshold is a scroll', () => {
    expect(classifyGesture(5, 30, T)).toBe('scroll')
    expect(classifyGesture(5, -30, T)).toBe('scroll')
  })

  it('exactly at the threshold stays pending (must exceed)', () => {
    expect(classifyGesture(8, 0, T)).toBe('pending')
    expect(classifyGesture(0, 8, T)).toBe('pending')
  })

  it('just past the threshold classifies', () => {
    expect(classifyGesture(9, 0, T)).toBe('scrub')
    expect(classifyGesture(0, 9, T)).toBe('scroll')
  })

  it('a perfect diagonal resolves to scroll (yield, do not hijack)', () => {
    expect(classifyGesture(20, 20, T)).toBe('scroll')
  })

  it('sub-threshold movement is pending', () => {
    expect(classifyGesture(3, 3, T)).toBe('pending')
    expect(classifyGesture(0, 0, T)).toBe('pending')
  })
})
