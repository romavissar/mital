"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ID_RE = /^[A-Za-z0-9._-]+$/;
const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

function assertId(id) {
  if (typeof id !== "string" || !ID_RE.test(id) || id === "." || id === "..") {
    throw new Error("Invalid local document ID");
  }
  return id;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateDocument(doc) {
  if (!isObject(doc) || doc.schema_version !== 1) {
    throw new Error("Unsupported or invalid local document version");
  }
  assertId(doc.business_id);
  if (typeof doc.business_name !== "string" || !doc.business_name.trim()) {
    throw new Error("Business name is required");
  }
  if (!isObject(doc.settings) || !["ro", "en"].includes(doc.settings.language)) {
    throw new Error("Invalid language setting");
  }
  if (doc.settings.appearance !== undefined && !["system", "light", "dark"].includes(doc.settings.appearance)) {
    throw new Error("Invalid appearance setting");
  }
  if (doc.settings.onboarding !== undefined && !["active", "later", "done"].includes(doc.settings.onboarding)) {
    throw new Error("Invalid onboarding state");
  }
  if (doc.settings.onboarding_step !== undefined && ![1, 2, 3, 4].includes(doc.settings.onboarding_step)) {
    throw new Error("Invalid onboarding step");
  }
  if (!["RON", "EUR", "USD"].includes(doc.settings.display_currency)) {
    throw new Error("Invalid display currency");
  }
  const fx = doc.settings.fx;
  if (!isObject(fx) || typeof fx.date !== "string" || typeof fx.source !== "string") {
    throw new Error("Invalid exchange-rate settings");
  }
  for (const key of ["ron_per_eur", "ron_per_usd"]) {
    if (fx[key] !== null && !(typeof fx[key] === "number" && Number.isFinite(fx[key]) && fx[key] > 0)) {
      throw new Error(`Invalid ${key} rate`);
    }
  }
  if (!isObject(doc.draft) || (doc.published !== null && !isObject(doc.published)) ||
      (doc.working !== undefined && doc.working !== null && (!isObject(doc.working.instance) || !isObject(doc.working.solution)))) {
    throw new Error("A draft and optional published roster are required");
  }
  if (doc.published_at !== undefined && (typeof doc.published_at !== "string" || Number.isNaN(Date.parse(doc.published_at)))) {
    throw new Error("Invalid publication time");
  }
  const accounting = doc.draft.currency;
  if (!["RON", "EUR", "USD"].includes(accounting)) throw new Error("Unsupported accounting currency");
  if (doc.published && doc.published.instance?.currency !== accounting) {
    throw new Error("Published and draft accounting currencies must match");
  }
  if (doc.working && JSON.stringify(doc.working.instance) !== JSON.stringify(doc.draft)) {
    throw new Error("Working schedule does not match its draft");
  }
  if (doc.settings.display_currency !== accounting || fx.ron_per_eur !== null || fx.ron_per_usd !== null) {
    const date = new Date(`${fx.date}T00:00:00Z`);
    if (!fx.source.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fx.date) ||
      Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== fx.date || date.getTime() > Date.now()) {
      throw new Error("A valid dated rate source is required for conversion");
    }
    for (const currency of doc.settings.display_currency === accounting ? [] : [accounting, doc.settings.display_currency]) {
      if (currency === "RON") continue;
      const value = currency === "EUR" ? fx.ron_per_eur : fx.ron_per_usd;
      if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) {
        throw new Error(`Missing RON per ${currency} rate`);
      }
    }
  }
  return doc;
}

async function readJson(file) {
  const stat = await fs.stat(file);
  if (stat.size > MAX_DOCUMENT_BYTES) throw new Error("Local document exceeds 16 MiB");
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeAtomic(file, contents, backupExisting = true) {
  const bytes = Buffer.from(contents, "utf8");
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error("Local document exceeds 16 MiB");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (backupExisting) {
      try {
        const previous = await fs.readFile(file);
        validateDocument(JSON.parse(previous.toString("utf8")));
        const backupTemp = `${file}.${randomUUID()}.bak.tmp`;
        try {
          await fs.writeFile(backupTemp, previous, { flag: "wx", mode: 0o600 });
          await fs.rename(backupTemp, `${file}.bak`);
        } catch (error) {
          await fs.rm(backupTemp, { force: true });
          throw error;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

class LocalStore {
  constructor(baseDir, defaultLanguage = "en") {
    this.baseDir = baseDir;
    this.defaultLanguage = defaultLanguage === "ro" ? "ro" : "en";
    this.businessesDir = path.join(baseDir, "businesses");
    this.pending = Promise.resolve();
  }

  file(id) {
    return path.join(this.businessesDir, `${assertId(id)}.json`);
  }

  async listBusinessIds() {
    await fs.mkdir(this.businessesDir, { recursive: true });
    return (await fs.readdir(this.businessesDir))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5))
      .filter((id) => ID_RE.test(id))
      .sort();
  }

  async loadBusiness(id) {
    const file = this.file(id);
    try {
      return validateDocument(await readJson(file));
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`No saved business ${id}`);
      throw new Error(`Could not open ${id}. A previous version may be recoverable: ${error.message}`);
    }
  }

  async saveBusiness(doc, validate = async () => {}) {
    validateDocument(doc);
    return this.enqueue(async () => { await validate(); return this.writeDocument(doc); });
  }

  enqueue(work) {
    const task = this.pending.then(work);
    this.pending = task.catch(() => {});
    return task;
  }

  async writeDocument(doc) {
    validateDocument(doc);
    await writeAtomic(this.file(doc.business_id), `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
  }

  async saveDraft(id, businessName, draft, settings, validate = async () => {}) {
    assertId(id);
    if (id !== `${draft.id}-${draft.start_date}`) throw new Error("Draft ID does not match week");
    return this.enqueue(async () => {
      await validate();
      let old = null;
      try { old = await this.loadBusiness(id); }
      catch (error) { if (!error.message.startsWith("No saved business")) throw error; }
      return this.writeDocument({
        schema_version: 1, business_id: id, business_name: businessName,
        settings, draft, working: old?.working && JSON.stringify(old.draft) === JSON.stringify(draft) ? old.working : null,
        published: old?.published ?? null, published_at: old?.published_at,
      });
    });
  }

  async saveWorking(id, instance, solution) {
    assertId(id);
    return this.enqueue(async () => {
      const doc = await this.loadBusiness(id);
      if (JSON.stringify(doc.draft) !== JSON.stringify(instance)) return false;
      await this.writeDocument({ ...doc, working: { instance, solution } });
      return true;
    });
  }

  async removeBusiness(id) {
    const file = this.file(id);
    await fs.rm(file, { force: true });
    await fs.rm(`${file}.bak`, { force: true });
  }

  async recoverBusiness(id) {
    return this.enqueue(async () => {
      const file = this.file(id);
      let doc;
      try { doc = validateDocument(await readJson(`${file}.bak`)); }
      catch (error) {
        if (error.code === "ENOENT") throw new Error("No previous save exists for this week.");
        throw new Error(`The previous save cannot be restored: ${error.message}`);
      }
      if (doc.business_id !== id) throw new Error("Backup ID does not match");
      await writeAtomic(file, `${JSON.stringify(doc, null, 2)}\n`, false);
      return doc;
    });
  }

  async backupStatus(id) {
    try {
      const doc = validateDocument(await readJson(`${this.file(id)}.bak`));
      return doc.business_id === id ? "available" : "damaged";
    } catch (error) { return error.code === "ENOENT" ? "missing" : "damaged"; }
  }

  async exportBackup(id, destination) {
    const doc = await this.loadBusiness(id);
    await writeAtomic(destination, `${JSON.stringify(doc, null, 2)}\n`, false);
    return destination;
  }

  async importBackup(source) {
    const doc = validateDocument(await readJson(source));
    await this.saveBusiness(doc);
    return doc;
  }

  async listSaved() {
    const ids = await this.listBusinessIds();
    const saved = [];
    for (const id of ids) {
      try {
        if ((await this.loadBusiness(id)).published) saved.push(id);
      } catch {
        // A damaged file remains available for explicit recovery.
      }
    }
    return saved;
  }

  async getSaved(id) {
    const doc = await this.loadBusiness(id);
    if (!doc.published) throw new Error(`No published roster for ${id}`);
    return doc.published;
  }

  async putSaved(id, saved, validate = async () => {}) {
    assertId(id);
    if (!isObject(saved) || !isObject(saved.instance) || !isObject(saved.solution)) {
      throw new Error("A solved roster is required to publish");
    }
    return this.enqueue(async () => {
      await validate();
      let old = null;
      try { old = await this.loadBusiness(id); }
      catch (error) { if (!error.message.startsWith("No saved business")) throw error; }
      await this.writeDocument({
        schema_version: 1,
        business_id: id,
        business_name: old?.business_name ?? saved.instance.id,
        settings: old?.settings ?? {
          language: this.defaultLanguage,
          display_currency: saved.instance.currency,
          fx: { date: "", source: "manager-entered", ron_per_eur: null, ron_per_usd: null },
        },
        draft: saved.instance,
        published: saved,
        published_at: new Date().toISOString(),
      });
      return saved;
    });
  }
}

module.exports = { LocalStore, assertId, validateDocument, writeAtomic };
