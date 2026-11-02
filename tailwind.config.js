// Tailwind is used ONLY by the Bushido dashboard (React). Preflight (Tailwind's
// global CSS reset) is off so the hand-written Swap/Bridge styles are untouched.
export default {
  content: ['./src/**/*.jsx'],
  corePlugins: { preflight: false },
  theme: { extend: {} },
};
