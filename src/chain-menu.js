// The chain menu: one compact button that opens a list, instead of a row of seven pills.
// Pure helpers (no DOM) so the list and the button text are unit-tested.

/** Items for the sheet: every chain, in table order, with its colour, and the active one marked. */
export function chainMenuItems(chains, activeKey) {
  return Object.entries(chains).map(([key, c]) => ({
    value: key,
    label: c.label,
    color: c.color,
    selected: key === activeKey,
  }));
}

/** What the button shows: the current chain's name and colour. Falls back safely if the key is unknown. */
export function chainMenuLabel(chains, activeKey) {
  const c = chains[activeKey] || Object.values(chains)[0];
  return { label: c.label, color: c.color };
}
