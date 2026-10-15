// Queue flow: waiting → called → washing → done (one machine).
// A called student has `noShowMinutes` to turn up; otherwise they go to the back
// of the queue (or are removed after MAX_MISSES) and the next person is called.
// Settings are read live from the store so staff changes apply immediately.

const MAX_MISSES = 2;

function createTurns({ store, notify }) {
  const settings = () => store.settings;
  const timeoutMs = () => settings().noShowMinutes * 60000;

  const call = (entry, at) => {
    store.setStatus(entry.id, 'called', at);
    notify(entry.deviceId, {
      title: "🧺 It's your turn!",
      body: `Bring your laundry to the laundry room within ${settings().noShowMinutes} minutes.`,
      tag: 'turn',
    });
  };

  // Free = nobody washing and nobody called and on their way.
  const machineFree = (date) => !store.list(date).some((e) => e.status === 'washing' || e.status === 'called');

  // Call the next waiting person if the machine is free.
  const callNext = (date, at, { except } = {}) => {
    if (!machineFree(date)) return null;
    const next = store.list(date).find((e) => e.status === 'waiting' && e.id !== except);
    if (next) call(next, at);
    return next || null;
  };

  const start = (id, at) => store.setStatus(id, 'washing', at);

  // Wash finished: tell them to collect it, and call the next person.
  const finish = (id, at) => {
    const entry = store.get(id);
    if (!entry || entry.status === 'done') return null;
    store.setStatus(id, 'done', at);
    notify(entry.deviceId, { title: '✅ Your wash is done', body: 'Please collect your laundry.', tag: 'done' });
    callNext(entry.date, at);
    return entry;
  };

  // Didn't turn up: back of the queue, or off the list after MAX_MISSES.
  const skip = (id, at, { auto = false } = {}) => {
    const entry = store.get(id);
    if (!entry || entry.status !== 'called') return null;
    const why = auto ? `You didn't arrive within ${settings().noShowMinutes} minutes` : "You weren't there when called";
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
      .filter((e) => e.status === 'called' && at - e.calledAt >= timeoutMs())
      .forEach((e) => skip(e.id, at, { auto: true }));
  };

  return { callNext, machineFree, start, finish, skip, sweep, MAX_MISSES };
}

// Rough wait estimate: each person ahead takes one wash.
// Returns { startIn: Map(id → ms until their wash should start), washLeft: ms left on the current wash }.
function estimate(list, { washMinutes }, at) {
  const wash = washMinutes * 60000;
  const current = list.find((e) => e.status === 'washing');
  const washLeft = current ? Math.max(0, current.startedAt + wash - at) : 0;
  const startIn = new Map();
  let t = washLeft;
  for (const e of list.filter((x) => x.status === 'called' || x.status === 'waiting')) {
    startIn.set(e.id, t);
    t += wash;
  }
  return { startIn, washLeft };
}

module.exports = { createTurns, estimate, MAX_MISSES };
