// Queue flow: waiting → called → washing (on a machine) → done.
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

  // Machines not washing and not being held for someone who has been called.
  const freeMachines = (date) => {
    const list = store.list(date);
    const busy = list.filter((e) => e.status === 'washing' || e.status === 'called').length;
    return Math.max(0, settings().machines - busy);
  };

  // Call one waiting person per free machine.
  const callNext = (date, at, { except } = {}) => {
    const called = [];
    let free = freeMachines(date);
    for (const e of store.list(date)) {
      if (free <= 0) break;
      if (e.status !== 'waiting' || e.id === except) continue;
      call(e, at);
      called.push(e);
      free -= 1;
    }
    return called;
  };

  // Arrived: put them on the lowest-numbered free machine.
  const start = (id, at) => {
    const entry = store.get(id);
    if (!entry) return null;
    const used = new Set(store.list(entry.date).filter((e) => e.status === 'washing').map((e) => e.machine));
    let machine = 1;
    while (used.has(machine) && machine < settings().machines) machine += 1;
    return store.setStatus(id, 'washing', at, { machine });
  };

  // Wash finished: tell them to collect it, and call the next person for that machine.
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

  return { callNext, freeMachines, start, finish, skip, sweep, MAX_MISSES };
}

// Rough wait estimate: simulate the machines working through the queue.
// Returns { startIn: Map(id → ms until their wash should start), machines: [...] }.
function estimate(list, { machines, washMinutes }, at) {
  const wash = washMinutes * 60000;
  const washing = list.filter((e) => e.status === 'washing');
  const machineInfo = Array.from({ length: machines }, (_, i) => {
    const e = washing.find((w) => w.machine === i + 1);
    return { number: i + 1, entry: e || null, left: e ? Math.max(0, e.startedAt + wash - at) : 0 };
  });
  // Washes on machines that no longer exist (machine count was lowered) still take time.
  const extra = washing.filter((e) => !(e.machine >= 1 && e.machine <= machines))
    .map((e) => Math.max(0, e.startedAt + wash - at));
  const slots = [...machineInfo.map((m) => m.left), ...extra].sort((a, b) => a - b).slice(0, Math.max(machines, 1));

  const startIn = new Map();
  for (const e of list.filter((x) => x.status === 'called' || x.status === 'waiting')) {
    slots.sort((a, b) => a - b);
    const begin = slots[0];
    startIn.set(e.id, begin);
    slots[0] = begin + wash;
  }
  return { startIn, machines: machineInfo };
}

module.exports = { createTurns, estimate, MAX_MISSES };
