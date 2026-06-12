import { remove } from 'lodash-es'

const eventCallbacksPairs = []

function findEventCallbacksPair(eventType) {
  return eventCallbacksPairs.find((eventObject) => eventObject.eventType === eventType)
}

function EventCallbacksPair(eventType, callback) {
  this.eventType = eventType
  this.callbacks = [callback]
}

class EventBus {
  on(eventType, callback) {
    const eventCallbacksPair = findEventCallbacksPair(eventType)
    if (eventCallbacksPair) {
      eventCallbacksPair.callbacks.push(callback)
    } else {
      eventCallbacksPairs.push(new EventCallbacksPair(eventType, callback))
    }
  }

  off(eventType, callback) {
    const eventCallbacksPair = findEventCallbacksPair(eventType)
    if (eventCallbacksPair) {
      remove(eventCallbacksPair.callbacks, (cb) => {
        return cb === callback
      })
    }
  }

  publish(eventType, args) {
    const eventCallbacksPair = findEventCallbacksPair(eventType)
    if (!eventCallbacksPair) return
    // Isolate subscribers: one throwing callback must not prevent the rest from
    // running. Iterate a copy so a subscriber that unsubscribes mid-publish does
    // not skip its neighbour.
    eventCallbacksPair.callbacks.slice().forEach((callback) => {
      try {
        callback(args)
      } catch (err) {
        console.error(`EventBus: subscriber for "${eventType}" threw:`, err)
      }
    })
  }
}

const eventBusInstance = new EventBus()
export default eventBusInstance
