import Url from 'url-parse'

export default class TurboQuery {
  constructor() {
    const tq = this
    tq.replaceTimer = 0
    tq.appendTimer = 0
    tq.url = Url(window.location.href, true)
  }

  replaceHref() {
    if (this.replaceTimer === 0) {
      this.replaceTimer = setTimeout(() => this._replaceHistory(), 250)
    }
  }

  toHref() {
    if (this.appendTimer === 0) {
      this.appendTimer = setTimeout(() => this._appendHistory(), 250)
    }
  }

  _replaceHistory() {
    window.history.replaceState(window.history.state, '', this.url.href)
    this.replaceTimer = 0
  }

  _appendHistory() {
    window.history.pushState(window.history.state, '', this.url.href)
    this.appendTimer = 0
  }

  replace(query) {
    this.url.set('query', this.filteredQuery(query))
    this.replaceHref()
  }

  to(query) {
    this.url.set('query', this.filteredQuery(query))
    this.toHref()
  }

  filteredQuery(query) {
    const filtered = {}
    Object.keys(query).forEach((key) => {
      const v = query[key]
      if (typeof v === 'undefined' || v === null) return
      filtered[key] = v
    })
    return filtered
  }

  update(target) {
    return this.constructor.project(target, this.parsed)
  }

  get parsed() {
    return this.url.query
  }

  get(key) {
    if (Object.prototype.hasOwnProperty.call(this.url.query, key)) {
      return TurboQuery.parseValue(this.url.query[key])
    }
    return null
  }

  static parseValue(v) {
    switch (v) {
      case 'null':
        return null
      case '':
        return null
      case 'undefined':
        return null
      case 'false':
        return false
      case 'true':
        return true
      default:
        break
    }
    if (!isNaN(parseFloat(v)) && isFinite(v)) {
      if (String(v).includes('.')) {
        return parseFloat(v)
      } else {
        return parseInt(v)
      }
    }
    return v
  }

  static project(target, source) {
    const keys = Object.keys(target)
    let idx
    for (idx in keys) {
      const k = keys[idx]
      if (Object.prototype.hasOwnProperty.call(source, k)) {
        target[k] = this.parseValue(source[k])
      }
    }
    return target
  }

  static nullTemplate(keys) {
    const d = {}
    keys.forEach((key) => {
      d[key] = null
    })
    return d
  }
}
