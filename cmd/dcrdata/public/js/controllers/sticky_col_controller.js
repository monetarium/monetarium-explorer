import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  connect() {
    this.ticking = false
    this._onScroll = () => {
      if (!this.ticking) {
        /* global requestAnimationFrame */
        requestAnimationFrame(() => {
          this.element.classList.toggle('is-scrolled', this.element.scrollLeft > 0)
          this.ticking = false
        })
        this.ticking = true
      }
    }
    this.element.addEventListener('scroll', this._onScroll, { passive: true })
    this._onScroll()
  }

  disconnect() {
    this.element.removeEventListener('scroll', this._onScroll)
  }
}
