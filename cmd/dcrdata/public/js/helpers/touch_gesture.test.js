import { describe, it, expect } from 'vitest'
import { classifyGesture, isDoubleTap } from './touch_gesture'

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

describe('isDoubleTap', () => {
  const at = (t, x = 100, y = 100) => ({ t, x, y })

  it('two close taps within the window are a double-tap', () => {
    expect(isDoubleTap(at(0), at(150))).toBe(true)
  })

  it('no prior tap is never a double-tap', () => {
    expect(isDoubleTap(null, at(150))).toBe(false)
    expect(isDoubleTap(undefined, at(150))).toBe(false)
  })

  it('exactly at the window still counts; just past it does not', () => {
    expect(isDoubleTap(at(0), at(300))).toBe(true)
    expect(isDoubleTap(at(0), at(301))).toBe(false)
  })

  it('exactly at the move threshold counts; just past it does not (each axis)', () => {
    expect(isDoubleTap(at(0, 100, 100), at(150, 130, 100))).toBe(true)
    expect(isDoubleTap(at(0, 100, 100), at(150, 131, 100))).toBe(false)
    expect(isDoubleTap(at(0, 100, 100), at(150, 100, 130))).toBe(true)
    expect(isDoubleTap(at(0, 100, 100), at(150, 100, 131))).toBe(false)
  })

  it('movement is sign-agnostic', () => {
    expect(isDoubleTap(at(0, 100, 100), at(150, 70, 70))).toBe(true)
    expect(isDoubleTap(at(0, 100, 100), at(150, 69, 100))).toBe(false)
  })

  it('respects custom window and moveThreshold', () => {
    expect(isDoubleTap(at(0), at(400), { windowMs: 500 })).toBe(true)
    expect(isDoubleTap(at(0, 0, 0), at(150, 10, 0), { moveThreshold: 5 })).toBe(false)
  })
})
