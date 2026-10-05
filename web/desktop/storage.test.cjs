"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { LocalStore, validateDocument } = require("./storage.cjs");

test("publish, backup, recovery, and import stay in local files", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mital-storage-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(path.join(directory, "profile"), "ro");

  const id = "example-2026-10-05";
  const first = { instance: { id: "example", currency: "RON" }, solution: { total: 100 } };
  const second = { instance: { id: "example", currency: "RON" }, solution: { total: 200 } };
  await store.putSaved(id, first);
  assert.equal(await store.backupStatus(id), "missing");
  await assert.rejects(store.recoverBusiness(id), /No previous save exists/);
  await store.putSaved(id, second);
  assert.equal(await store.backupStatus(id), "available");
  assert.deepEqual(await store.listSaved(), [id]);
  assert.deepEqual(await store.getSaved(id), second);
  assert.match((await store.loadBusiness(id)).published_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal((await store.loadBusiness(id)).settings.language, "ro");

  const file = path.join(directory, "profile", "businesses", `${id}.json`);
  assert.equal(JSON.parse(await fs.readFile(`${file}.bak`, "utf8")).published.solution.total, 100);

  const backup = path.join(directory, "exported.mital.json");
  await store.exportBackup(id, backup);
  const imported = new LocalStore(path.join(directory, "other-profile"));
  await imported.importBackup(backup);
  assert.deepEqual(await imported.getSaved(id), second);

  await fs.writeFile(file, "not JSON");
  await assert.rejects(store.loadBusiness(id), /previous version may be recoverable/);
  await assert.rejects(store.importBackup(backup));
  assert.equal(JSON.parse(await fs.readFile(`${file}.bak`, "utf8")).published.solution.total, 100);
  await store.recoverBusiness(id);
  assert.deepEqual(await store.getSaved(id), first);
  await fs.writeFile(`${file}.bak`, "damaged backup");
  assert.equal(await store.backupStatus(id), "damaged");
  await store.removeBusiness(id);
  assert.deepEqual(await store.listSaved(), []);
  assert.equal(await store.backupStatus(id), "missing");
});

test("document IDs cannot escape the local business folder", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mital-storage-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  await assert.rejects(store.getSaved("../../private"), /Invalid local document ID/);
});

test("a converted display currency requires dated rates while the accounting currency stays intact", () => {
  const doc = {
    schema_version: 1,
    business_id: "cafe-2026-10-05",
    business_name: "Cafe",
    settings: {
      language: "en", display_currency: "USD",
      fx: { date: "2026-10-01", source: "test bulletin", ron_per_eur: 5, ron_per_usd: 4 },
    },
    draft: { currency: "EUR" },
    published: { instance: { currency: "EUR" }, solution: {} },
  };
  assert.equal(validateDocument(doc), doc);
  assert.throws(() => validateDocument({ ...doc, settings: { ...doc.settings, fx: { ...doc.settings.fx, ron_per_usd: null } } }), /Missing RON per USD/);
  assert.throws(() => validateDocument({ ...doc, published: { instance: { currency: "RON" } } }), /accounting currencies must match/);
});

test("draft autosave cannot erase a published roster", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mital-draft-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  const id = "cafe-2026-10-05";
  const instance = { id: "cafe", start_date: "2026-10-05", currency: "RON" };
  const settings = { language: "en", display_currency: "RON", fx: { date: "", source: "", ron_per_eur: null, ron_per_usd: null } };
  const saved = { instance, solution: { status: "optimal" } };
  await Promise.all([
    store.saveDraft(id, "Cafe", instance, settings),
    store.putSaved(id, saved),
    store.saveDraft(id, "Cafe", { ...instance, note: "later edit" }, settings),
  ]);
  const doc = await store.loadBusiness(id);
  assert.equal(doc.draft.note, "later edit");
  assert.deepEqual(doc.published, saved);
  assert.match(doc.published_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("working schedule survives reopening and is cleared when its draft changes", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mital-working-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  const id = "cafe-2026-10-05";
  const instance = { id: "cafe", start_date: "2026-10-05", currency: "RON" };
  const settings = { language: "en", display_currency: "RON", fx: { date: "", source: "", ron_per_eur: null, ron_per_usd: null } };
  await store.saveDraft(id, "Cafe", instance, settings);
  assert.equal(await store.saveWorking(id, instance, { status: "feasible" }), true);
  await store.saveDraft(id, "Cafe", instance, settings);
  assert.equal((await store.loadBusiness(id)).working.solution.status, "feasible");
  const changed = { ...instance, note: "new staffing" };
  assert.equal(await store.saveWorking(id, changed, { status: "feasible" }), false);
  await store.saveDraft(id, "Cafe", changed, settings);
  assert.equal((await store.loadBusiness(id)).working, null);
});

test("validation and writes keep request order", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mital-order-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new LocalStore(directory);
  const id = "cafe-2026-10-05";
  const instance = { id: "cafe", start_date: "2026-10-05", currency: "RON" };
  const settings = { language: "en", display_currency: "RON", fx: { date: "", source: "", ron_per_eur: null, ron_per_usd: null } };
  let release;
  const first = store.saveDraft(id, "Cafe", instance, settings, () => new Promise((resolve) => { release = resolve; }));
  const second = store.saveBusiness({ schema_version: 1, business_id: id, business_name: "Cafe", draft: instance,
    settings: { ...settings, language: "ro" }, published: null });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  assert.equal((await store.loadBusiness(id)).settings.language, "ro");
});
