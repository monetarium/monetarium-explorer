/* global Turbo */
import { Controller } from '@hotwired/stimulus'

export default class extends Controller {
  execute(e) {
    e.preventDefault()
    const search = e.target[0].value.trim()
    if (search === '') {
      return
    }
    Turbo.visit(`/search?search=${search}`)
  }
}
