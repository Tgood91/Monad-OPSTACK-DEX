// Retry a read once before giving up, so a one-second hiccup never reaches the screen.
// For READS only (balances, rewards, status). Never wrap a send or a signature.
export async function retryOnce(fn, { ms = 1200, sleep = (t) => new Promise((r) => setTimeout(r, t)) } = {}) {
  try {
    return await fn();
  } catch {
    await sleep(ms);
    return fn();
  }
}
