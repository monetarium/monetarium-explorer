import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  copyTextToClipboard(clickEvent) {
    const parentNode = clickEvent.srcElement.parentNode
    const textContent = parentNode.textContent.trim().split(' ')[0]
    navigator.clipboard
      .writeText(textContent)
      .then(
        () => {
          const alertCopy = parentNode.getElementsByClassName('alert-copy')[0]
          alertCopy.textContent = 'Copied'
          alertCopy.style.display = 'inline-table'
          setTimeout(() => {
            alertCopy.textContent = ''
            alertCopy.style.display = 'none'
          }, 1000)
          return null
        },
        (reason) => {
          console.error('Unable to copy:', reason)
        }
      )
      .catch((err) => console.error('Clipboard error:', err))
  }
}
