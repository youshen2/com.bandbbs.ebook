let timerId = null
const subs = new Set()

function emit() {
  const d = new Date()
  const hours = d.getHours()
  const minutes = d.getMinutes()
  subs.forEach(fn => {
    try { fn({ hours, minutes }) } catch (e) {}
  })
}

function start() {
  if (timerId !== null) return
  emit()
  timerId = setInterval(emit, 60000)
}

function stop() {
  if (timerId !== null) {
    clearInterval(timerId)
    timerId = null
  }
}

function subscribe(fn) {
  subs.add(fn)
  return function unsubscribe() {
    subs.delete(fn)
  }
}

export default { start, stop, subscribe }