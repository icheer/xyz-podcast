// Overlay entries use Vue Router so its history positions stay consistent.
export function createOverlayHistory(router, onChange, onError) {
  const key = "xyzOverlayStack";
  const read = () => {
    const value = window.history.state?.[key];
    return Array.isArray(value)
      ? [...new Set(value.filter(name => name === "player" || name === "queue"))]
      : [];
  };
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
    destroy: unsubscribe,
  };
}
