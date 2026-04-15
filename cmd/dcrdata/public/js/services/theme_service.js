import { setCookie } from './cookie_service'
import globalEventBus from './event_bus_service'

const sunIcon = document.getElementById('sun-icon')
const darkBGCookieName = 'dcrdataDarkBG'

export function darkEnabled() {
  return document.cookie.includes(darkBGCookieName)
}

function menuToggle() {
  return document.querySelector('#menu-toggle input')
}

function updateThemeColor(color) {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', color)
  }
}

if (darkEnabled()) {
  toggleToDarkClasses(document.body)
} else {
  toggleToLightClasses(document.body)
}
function toggleToDarkClasses(body) {
  if (sunIcon) {
    sunIcon.classList.remove('monicon-sun-fill')
    sunIcon.classList.add('monicon-sun-stroke')
  }
  body.classList.add('darkBG')
  updateThemeColor('#292929')
}
function toggleToLightClasses(body) {
  body.classList.remove('darkBG')
  if (sunIcon) {
    sunIcon.classList.remove('monicon-sun-stroke')
    sunIcon.classList.add('monicon-sun-fill')
  }
  updateThemeColor(body.dataset.themeColor || '#ffffff')
}
export function toggleSun() {
  if (darkEnabled()) {
    setCookie(darkBGCookieName, '', 0)
    toggleToLightClasses(document.body)
    globalEventBus.publish('NIGHT_MODE', { nightMode: false })
  } else {
    setCookie(darkBGCookieName, 1, 525600)
    toggleToDarkClasses(document.body)
    globalEventBus.publish('NIGHT_MODE', { nightMode: true })
  }
}

document.addEventListener('turbolinks:before-render', (event) => {
  if (darkEnabled()) {
    toggleToDarkClasses(event.data.newBody)
  } else {
    toggleToLightClasses(event.data.newBody)
  }
})

export function toggleMenu() {
  const checkbox = menuToggle()
  checkbox.checked = !checkbox.checked
  checkbox.dispatchEvent(new window.Event('change'))
}

export function closeMenu() {
  const checkbox = menuToggle()
  if (!checkbox.checked) return
  checkbox.checked = false
  checkbox.dispatchEvent(new window.Event('change'))
}
