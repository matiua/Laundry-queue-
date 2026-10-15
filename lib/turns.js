// Queue flow: waiting → called → washing → done.
// A called student has `timeoutMs` to turn up; otherwise they go to the back
// of the queue (or are removed after MAX_MISSES) and the next person is called.

const MAX_MISSES = 2;

function createTurns({ store, notify, timeoutMs }) {
  const mins = Math.round(timeoutMs / 60000);

  const call = (entry, at) => {
    store.setStatus(entry.id, 'called', at);
    notify(entry.deviceId, {
      title: "🧺 It's your turn!",
      body: `Bring your laundry to the laundry room within ${mins} minutes.`,
      tag: 'turn',
    });
  };

  // Call the next waiting person, unless someone is already called.
  const callNext = (date, at, { except } = {}) => {
    const list = store.list(date);
    if (list.some((e) => e.status === 'called')) return null;
    const next = list.find((e) => e.status === 'waiting' && e.id !== except);
    if (next) call(next, at);
    return next || null;
  };

  // Staff one-tap: finish what's washing, then call the next person.
  const finishAndCallNext = (date, at) => {
    store.list(date).filter((e) => e.status === 'washing').forEach((e) => finish(e.id));
    return callNext(date, at);
  };

  const start = (id) => store.setStatus(id, 'washing');

  const finish = (id) => {
    const entry = store.setStatus(id, 'done');
    if (entry) {
      notify(entry.deviceId, { title: '✅ Your wash is done', body: 'Please collect your laundry.', tag: 'done' });
    }
    return entry;
  };

  // Didn't turn up: back of the queue, or off the list after MAX_MISSES.
  const skip = (id, at, { auto = false } = {}) => {
    const entry = store.get(id);
    if (!entry || entry.status !== 'called') return null;
    const why = auto ? `You didn't arrive within ${mins} minutes` : "You weren't there when called";
    if ((entry.misses || 0) + 1 >= MAX_MISSES) {
      store.remove(id);
      notify(entry.deviceId, { title: 'Removed from the laundry queue', body: `${why}, again. Scan the QR code to join again.`, tag: 'turn' });
    } else {
      store.requeue(id, at);
      notify(entry.deviceId, { title: 'You missed your turn', body: `${why}, so you've been moved to the back of the queue.`, tag: 'turn' });
    }
    callNext(entry.date, at, { except: id });
    return entry;
  };

  // Auto-skip anyone whose time to turn up has run out.
  const sweep = (date, at) => {
    store.list(date)
      .filter((e) => e.status === 'called' && at - e.calledAt >= timeoutMs)
      .forEach((e) => skip(e.id, at, { auto: true }));
  };

  return { callNext, finishAndCallNext, start, finish, skip, sweep, MAX_MISSES };
}

module.exports = { createTurns, MAX_MISSES };
