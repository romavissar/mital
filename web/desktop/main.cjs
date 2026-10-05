"use strict";

const { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { LocalStore, validateDocument, writeAtomic } = require("./storage.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const MAX_IPC_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
const SOLVER_OPS = new Set([
  "solve", "pareto", "repair", "margins", "explain", "demand",
  "validateInstance", "validateSaved",
]);

let mainWindow;
let printWindow;
let printPayload;
let store;

const priorUserData = app.getPath("userData");
const mitalUserData = path.join(app.getPath("appData"), "mital");
mkdirSync(mitalUserData, { recursive: true });
app.setName("mital");
app.setPath("userData", mitalUserData);

function seedDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "data")
    : path.join(PROJECT_ROOT, "data");
}

function solverCommand() {
  if (app.isPackaged) {
    return {
      command: path.join(
        process.resourcesPath,
        "solver",
        process.platform === "win32" ? "mital-solver-bridge.exe" : "mital-solver-bridge",
      ),
      args: [],
    };
  }
  return {
    command: process.env.MITAL_PYTHON || (process.platform === "win32" ? "python" : "python3"),
    args: ["-m", "mital_solver.desktop_bridge"],
  };
}

function assertSmall(value) {
  const serialized = JSON.stringify(value);
  if (!serialized || Buffer.byteLength(serialized) > MAX_IPC_BYTES) {
    throw new Error("Request exceeds 16 MiB");
  }
  return serialized;
}

function runSolver(op, payload, options = {}) {
  if (!SOLVER_OPS.has(op) || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return Promise.reject(new Error("Invalid solver request"));
  }
  const request = assertSmall({ op, payload, duals: options.duals === true });
  const { command, args } = solverCommand();
  const timeoutMs = ["pareto", "margins"].includes(op) ? 180_000 : 90_000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: app.isPackaged ? process.resourcesPath : PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, MITAL_DATA_DIR: seedDir() },
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const done = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      done(new Error(`Solver timed out after ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
        child.kill();
        done(new Error("Solver response exceeded 24 MiB"));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on("error", (error) => done(new Error(`Could not start local solver: ${error.message}`)));
    child.on("close", () => {
      try {
        const response = JSON.parse(stdout);
        if (response.ok !== true) throw new Error(response.error || "Solver failed");
        done(null, response.result);
      } catch (error) {
        done(new Error(`Local solver error: ${error.message}${stdout ? "" : ` ${stderr}`}`));
      }
    });
    child.stdin.on("error", (error) => done(new Error(`Could not send solver request: ${error.message}`)));
    child.stdin.end(request);
  });
}

function register(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error("Untrusted desktop request");
    }
    assertSmall(args);
    return handler(...args);
  });
}

function registerHandlers() {
  register("mital:solver", ({ op, payload, duals }) => runSolver(op, payload, { duals }));
  register("mital:businesses", () => store.listBusinessIds());
  register("mital:business", async (id) => {
    const doc = await store.loadBusiness(id);
    if (doc.working) await runSolver("validateSaved", doc.working);
    return doc;
  });
  register("mital:save-business", async (doc) => {
    validateDocument(doc);
    return store.saveBusiness(doc, async () => {
      if (doc.published) await runSolver("validateSaved", doc.published);
      if (doc.working) await runSolver("validateSaved", doc.working);
    });
  });
  register("mital:save-draft", (id, businessName, draft, settings) => store.saveDraft(id, businessName, draft, settings));
  register("mital:save-working", async (id, instance, solution) => {
    await runSolver("validateSaved", { instance, solution });
    return store.saveWorking(id, instance, solution);
  });
  register("mital:recover-business", (id) => store.recoverBusiness(id));
  register("mital:backup-status", (id) => store.backupStatus(id));
  register("mital:delete-business", (id) => store.removeBusiness(id));
  register("mital:saved", () => store.listSaved());
  register("mital:get-saved", (id) => store.getSaved(id));
  register("mital:put-saved", (id, body) => store.putSaved(id, body,
    () => runSolver("validateSaved", body)));
  register("mital:export-backup", async (id) => {
    const selected = await dialog.showSaveDialog(mainWindow, {
      title: "Export mital backup",
      defaultPath: `${id}.mital.json`,
      filters: [{ name: "mital backup", extensions: ["json"] }],
    });
    if (selected.canceled || !selected.filePath) return null;
    return store.exportBackup(id, selected.filePath);
  });
  register("mital:export-csv", async (name, csv) => {
    if (typeof name !== "string" || !/^[A-Za-z0-9._-]+$/.test(name) || typeof csv !== "string" || !csv.startsWith("\uFEFF") || Buffer.byteLength(csv) > MAX_IPC_BYTES) {
      throw new Error("Invalid CSV export");
    }
    const selected = await dialog.showSaveDialog(mainWindow, {
      title: "Export planning CSV", defaultPath: `${name}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (selected.canceled || !selected.filePath) return null;
    await writeAtomic(selected.filePath, csv, false);
    return selected.filePath;
  });
  register("mital:import-backup", async () => {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: "Import mital backup",
      properties: ["openFile"],
      filters: [{ name: "mital backup", extensions: ["json"] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const source = selected.filePaths[0];
    const contents = await fs.readFile(source, "utf8");
    if (Buffer.byteLength(contents) > MAX_IPC_BYTES) throw new Error("Backup exceeds 16 MiB");
    const parsed = JSON.parse(contents);
    if (parsed?.schema_version === 1) {
      const doc = validateDocument(parsed);
      if (doc.published) await runSolver("validateSaved", doc.published);
      if (doc.working) await runSolver("validateSaved", doc.working);
      await store.saveBusiness(doc);
      return doc.business_id;
    }
    // Old web releases wrote the SavedRoster object directly to data/saved/.
    const saved = await runSolver("validateSaved", parsed);
    const id = `${saved.instance.id}-${saved.instance.start_date}`;
    await store.putSaved(id, saved);
    return id;
  });
  register("mital:open-data-folder", async () => {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const error = await shell.openPath(app.getPath("userData"));
    if (error) throw new Error(error);
  });
  register("mital:print", async (payload) => {
    if (!payload || !payload.settings || typeof payload.settings !== "object") throw new Error("Missing print currency settings");
    await runSolver("validateSaved", { instance: payload.instance, solution: payload.solution });
    const printDoc = {
      schema_version: 1,
      business_id: `${payload.instance.id}-${payload.instance.start_date}`,
      business_name: payload.instance.id,
      settings: payload.settings,
      draft: payload.instance,
      published: null,
    };
    validateDocument(printDoc);
    printPayload = payload;
    if (printWindow && !printWindow.isDestroyed()) printWindow.close();
    const currentPrintWindow = new BrowserWindow({
      width: 1100,
      height: 800,
      title: "Print",
      parent: mainWindow,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    printWindow = currentPrintWindow;
    currentPrintWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    currentPrintWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    currentPrintWindow.on("closed", () => {
      if (printWindow === currentPrintWindow) {
        printWindow = null;
        printPayload = null;
      }
    });
    const devUrl = process.env.MITAL_DEV_SERVER_URL;
    if (devUrl && !app.isPackaged) {
      await currentPrintWindow.loadURL(`${devUrl.replace(/\/$/, "")}/print.html`);
    } else {
      await currentPrintWindow.loadFile(path.join(__dirname, "..", "dist", "print.html"));
    }
  });
  ipcMain.handle("mital:get-print-payload", (event) => {
    if (!printWindow || event.sender !== printWindow.webContents || event.senderFrame !== printWindow.webContents.mainFrame) {
      throw new Error("Untrusted print request");
    }
    return printPayload;
  });
}

async function migrateLegacyData() {
  const existing = new Set(await store.listBusinessIds());
  // Keep the old directory name so existing local businesses survive the rename.
  const oldFolders = new Set([priorUserData, path.join(app.getPath("appData"), "Rota"), path.join(app.getPath("appData"), "web")]);
  for (const oldFolder of oldFolders) {
    if (oldFolder === mitalUserData) continue;
    const oldStore = new LocalStore(oldFolder);
    for (const id of await oldStore.listBusinessIds()) {
      if (existing.has(id)) continue;
      try {
        const doc = await oldStore.loadBusiness(id);
        if (doc.published) await runSolver("validateSaved", doc.published);
        if (doc.working) await runSolver("validateSaved", doc.working);
        await store.saveBusiness(doc);
        existing.add(id);
      } catch (error) {
        console.error(`Could not migrate local document ${id}: ${error.message}`);
      }
    }
  }
  if (app.isPackaged) return;
  const oldSavedDir = path.join(PROJECT_ROOT, "data", "saved");
  let names = [];
  try {
    names = await fs.readdir(oldSavedDir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const name of names.filter((item) => /^[A-Za-z0-9._-]+\.json$/.test(item))) {
    const id = name.slice(0, -5);
    if (existing.has(id)) continue;
    try {
      const saved = JSON.parse(await fs.readFile(path.join(oldSavedDir, name), "utf8"));
      await runSolver("validateSaved", saved);
      await store.putSaved(id, saved);
      existing.add(id);
    } catch (error) {
      console.error(`Could not migrate saved roster ${id}: ${error.message}`);
    }
  }
}

function createWindow() {
  const icon = path.join(__dirname, "..", "dist", "brand", "mital-icon.png");
  if (process.platform === "darwin") app.dock?.setIcon(icon);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171D20" : "#F4F5F1",
    title: "mital",
    icon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  const devUrl = process.env.MITAL_DEV_SERVER_URL;
  if (devUrl && !app.isPackaged) {
    const parsed = new URL(devUrl);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      throw new Error("Development URL must be loopback only");
    }
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(async () => {
  store = new LocalStore(
    app.getPath("userData"),
    app.getLocale().toLowerCase().startsWith("ro") ? "ro" : "en",
  );
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const devUrl = process.env.MITAL_DEV_SERVER_URL;
    const allowedDev = devUrl && !app.isPackaged && (
      details.url.startsWith(devUrl) || details.url.startsWith("ws://localhost:") || details.url.startsWith("ws://127.0.0.1:")
    );
    callback({ cancel: !details.url.startsWith("file:") && !allowedDev });
  });
  await migrateLegacyData();
  registerHandlers();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
