// import 'core-js/stable';
import { Application } from '@hotwired/stimulus'
import { definitionsFromContext } from '@hotwired/stimulus-webpack-helpers'
import 'regenerator-runtime/runtime'
import globalEventBus from './js/services/event_bus_service'
import ws from './js/services/messagesocket_service'
import { darkEnabled } from './js/services/theme_service'
import humanize from './js/helpers/humanize_helper'

import './scss/application.scss'

window.darkEnabled = darkEnabled

const application = Application.start()
const context = import.meta.webpackContext('./js/controllers', {
  recursive: true,
  regExp: /(?<!\.test)\.js$/
})
application.load(definitionsFromContext(context))

document.addEventListener('turbolinks:load', (_e) => {
  document.querySelectorAll('.jsonly').forEach((el) => {
    el.classList.remove('jsonly')
  })
})

export function notifyNewBlock(newBlock) {
  if (window.Notification.permission !== 'granted') return
  const block = newBlock.block
  const newBlockNtfn = new window.Notification('New Monetarium Block Mined', {
    body: `Block mined at height <b>${block.height}</b>`,
    icon: '/images/monetarium144x128.png',
    notifyError: (e) => console.error('Error showing notification:', e)
  })
  setTimeout(() => newBlockNtfn.close(), 3000)
}

function getSocketURI(loc) {
  const protocol = loc.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${loc.host}/ws`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createWebSocket(loc) {
  // wait a bit to prevent websocket churn from drive by page loads
  const uri = getSocketURI(loc)
  await sleep(300)
  ws.connect(uri)

  const updateBlockData = function (event) {
    const newBlock = JSON.parse(event)
    if (window.loggingDebug) {
      console.log('Block received:', newBlock)
    }
    // Parse deterministically across engines; iOS/WebKit rejects forms V8
    // accepts. Fall back to "now" rather than render a NaN Age on a live row.
    let unixStamp = humanize.toUnixStamp(newBlock.block.time)
    if (isNaN(unixStamp)) {
      console.warn('Unparseable block.time, using current time:', newBlock.block.time)
      unixStamp = Date.now() / 1000
    }
    newBlock.block.unixStamp = unixStamp
    globalEventBus.publish('BLOCK_RECEIVED', newBlock)
  }
  ws.registerEvtHandler('newblock', updateBlockData)
  ws.registerEvtHandler('exchange', (e) => {
    globalEventBus.publish('EXCHANGE_UPDATE', JSON.parse(e))
  })
}

// Debug logging can be enabled by entering logDebug(true) in the console.
// Your setting will persist across sessions.
window.loggingDebug = window.localStorage.getItem('loggingDebug') === '1'
window.logDebug = (yes) => {
  window.loggingDebug = yes
  window.localStorage.setItem('loggingDebug', yes ? '1' : '0')
  return `debug logging set to ${yes ? 'true' : 'false'}`
}

createWebSocket(window.location)
globalEventBus.on('BLOCK_RECEIVED', notifyNewBlock)
