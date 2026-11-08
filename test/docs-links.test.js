import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Keeps the assistant-facing docs honest: CLAUDE.md and every dex-skills/*/SKILL.md name real files, relative links resolve,
// and each skill's `name:` matches its folder. A doc that points at a file that no longer exists misleads the next person.
const root = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p.replace(/\/$/, "")));

// Paths that are intentionally not in the repo: a file each person creates (never committed) and a planned module.
const ALLOWED_MISSING = new Set(["server/.env", "server/cctp.js"]);

const docs = [
  "CLAUDE.md",
  ...fs
    .readdirSync(path.join(root, "dex-skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, "dex-skills", d.name, "SKILL.md")))
    .map((d) => `dex-skills/${d.name}/SKILL.md`),
];

const PATH_RE =
  /`((?:src|server|test|scripts|dex-skills|contracts|\.github)\/[A-Za-z0-9_./@-]+|README\.md|CHANGELOG\.md|CHAINS\.md|DEPLOY\.md|package\.json|index\.html)`/g;

test("there is a CLAUDE.md and at least the core skill files", () => {
  assert.ok(exists("CLAUDE.md"));
  for (const s of [
    "dex-chain-config",
    "dex-swap-engine",
    "dex-bridge",
    "dex-dojo-faucet",
    "dex-audit",
    "dex-test",
    "dex-deploy",
  ]) {
    assert.ok(exists(`dex-skills/${s}/SKILL.md`), s);
  }
});

test("every repo path named in the docs exists", () => {
  const missing = [];
  for (const doc of docs) {
    for (const m of read(doc).matchAll(PATH_RE)) {
      const p = m[1];
      if (p.includes("*") || p.includes("<") || ALLOWED_MISSING.has(p)) continue;
      if (!exists(p)) missing.push(`${doc}: ${p}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("relative markdown links in the docs resolve", () => {
  const broken = [];
  for (const doc of docs) {
    for (const m of read(doc).matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)/g)) {
      const target = path.normalize(path.join(path.dirname(doc), m[1]));
      if (!exists(target)) broken.push(`${doc}: ${m[1]}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("each skill has a name that matches its folder and a description", () => {
  for (const doc of docs.filter((d) => d.startsWith("dex-skills/"))) {
    const text = read(doc);
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, `${doc} has frontmatter`);
    const name = (fm[1].match(/^name:\s*(.+)$/m) || [])[1]?.trim();
    const desc = (fm[1].match(/^description:\s*(.+)$/m) || [])[1]?.trim();
    assert.equal(name, doc.split("/")[1], `${doc} name matches its folder`);
    assert.ok(desc && desc.length > 30, `${doc} has a real description`);
  }
});
