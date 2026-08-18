import { describe, test, expect, beforeEach } from 'vitest'
import { darkEnabled, toggleSun } from './theme_service'

const darkBGCookieName = 'monetariumDarkBG'

// The theme cookie is value-based: =1 is dark, =0 is light. The explicit light
// choice must survive as a value (not be deleted), otherwise "chose light" is
// indistinguishable from "no choice" and a landing-page ?theme=dark link could
// override it.
describe('theme_service dark mode cookie', () => {
  beforeEach(() => {
    document.cookie = `${darkBGCookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  })

  test('darkEnabled is true for monetariumDarkBG=1', () => {
    document.cookie = `${darkBGCookieName}=1; path=/`
    expect(darkEnabled()).toBe(true)
  })

  test('darkEnabled is false for monetariumDarkBG=0', () => {
    document.cookie = `${darkBGCookieName}=0; path=/`
    expect(darkEnabled()).toBe(false)
  })

  test('darkEnabled is false with no cookie', () => {
    expect(darkEnabled()).toBe(false)
  })

  test('toggleSun from light persists dark as value 1', () => {
    toggleSun()
    expect(document.cookie).toContain(`${darkBGCookieName}=1`)
    expect(darkEnabled()).toBe(true)
  })

  test('toggleSun from dark persists light as value 0 instead of deleting', () => {
    document.cookie = `${darkBGCookieName}=1; path=/`
    toggleSun()
    expect(document.cookie).toContain(`${darkBGCookieName}=0`)
    expect(darkEnabled()).toBe(false)
  })
})
