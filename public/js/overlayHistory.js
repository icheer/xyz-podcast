// Page and overlay entries share Vue Router's history positions.
export function createOverlayHistory(router, onChange, onError) {
  const history = router.options.history;
  const key = "xyzOverlayStack";
  const read = () => {
    const value = window.history.state?.[key];
    return Array.isArray(value)
      ? [...new Set(value.filter(name => ["player", "queue", "library", "about"].includes(name)))]
      : [];
  };

  function homePosition() {
    const { position, back, xyzHomePosition } = history.state;
    const pagePosition = position - read().length;
    if (router.currentRoute.value.meta.board) return pagePosition;
    if (Number.isInteger(xyzHomePosition) && xyzHomePosition >= 0 && xyzHomePosition <= pagePosition) {
      return xyzHomePosition;
    }
    // An entry created before the upgrade may still have a board one step back.
    return back && router.resolve(back).meta.board ? position - 1 : pagePosition;
  }

  // Persist the board (or shared landing page) on each new entry so reloads
  // and Forward navigation can return to the same starting point.
  const push = history.push;
  history.push = (path, state) => push(path, { ...state, xyzHomePosition: homePosition() });

  let updating = false;
  let pending = Promise.resolve();
  const sync = () => onChange(read());
  const unsubscribe = router.afterEach((_to, _from, failure) => {
    if (!failure && !updating) sync();
  });

  const back = count => new Promise(resolve => {
    const stop = router.afterEach((_to, _from, failure) => {
      stop();
      resolve(!failure);
    });
    router.go(-count);
  });

  async function update(next) {
    const current = read();
    let common = 0;
    while (common < current.length && current[common] === next[common]) common++;
    updating = true;
    try {
      // Consume closed overlays instead of leaving invisible extra Back steps.
      if (current.length > common && !await back(current.length - common)) return;
      for (let i = common; i < next.length; i++) {
        await router.push({
          path: router.currentRoute.value.fullPath,
          force: true,
          state: { [key]: next.slice(0, i + 1) },
        });
      }
    } finally {
      updating = false;
      sync();
    }
  }

  function enqueue(job) {
    pending = pending.then(job).catch(error => {
      sync();
      onError(error);
    });
    return pending;
  }

  return {
    sync,
    set(name, open) {
      return enqueue(() => {
        const current = read();
        return update(open
          ? current.includes(name) ? current : [...current, name]
          : current.filter(item => item !== name));
      });
    },
    navigate(path) {
      return enqueue(async () => {
        await update([]);
        await router.push(path);
      });
    },
    returnHome() {
      return enqueue(async () => {
        if (router.currentRoute.value.meta.board) return;
        const steps = history.state.position - homePosition();
        if (steps > 0 && !await back(steps)) return;
        // A shared detail link occupies the first app entry. Reuse it for home.
        if (!router.currentRoute.value.meta.board) await router.replace("/");
      });
    },
    destroy() {
      unsubscribe();
      history.push = push;
    },
  };
}
