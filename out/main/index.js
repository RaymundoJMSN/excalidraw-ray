"use strict";
const electron = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
let DIR, PROJ, STATE_FILE, trashFn;
function init({ dir: dir2, trash }) {
  DIR = dir2;
  PROJ = path.join(dir2, "projects");
  STATE_FILE = path.join(dir2, "state.json");
  trashFn = trash;
  fs.mkdirSync(PROJ, { recursive: true });
}
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { last: null, projects: {} };
  }
}
function writeState(s) {
  fs.writeFileSync(STATE_FILE + ".tmp", JSON.stringify(s, null, 2));
  fs.renameSync(STATE_FILE + ".tmp", STATE_FILE);
}
const sceneFile = (id) => path.join(PROJ, id + ".excalidraw");
const EMPTY = JSON.stringify({ type: "excalidraw", version: 2, source: "excalidraw-ray", elements: [], appState: { theme: "dark" }, files: {} });
function list() {
  const s = readState();
  return Object.entries(s.projects).map(([id, p]) => {
    let mtime = 0;
    try {
      mtime = fs.statSync(sceneFile(id)).mtimeMs;
    } catch {
    }
    return { id, name: p.name, updatedAt: mtime };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}
function create(name) {
  const s = readState();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  fs.writeFileSync(sceneFile(id), EMPTY);
  s.projects[id] = { name };
  s.last = id;
  writeState(s);
  return id;
}
function load(id) {
  try {
    return fs.readFileSync(sceneFile(id), "utf8");
  } catch {
    return null;
  }
}
async function save(id, json) {
  JSON.parse(json);
  const f = sceneFile(id);
  if (fs.existsSync(f)) await fsp.copyFile(f, f + ".bak");
  await fsp.writeFile(f + ".tmp", json);
  await fsp.rename(f + ".tmp", f);
}
function rename(id, name) {
  const s = readState();
  if (s.projects[id]) {
    s.projects[id].name = name;
    writeState(s);
  }
}
async function remove(id) {
  const s = readState();
  delete s.projects[id];
  if (s.last === id) s.last = Object.keys(s.projects)[0] ?? null;
  writeState(s);
  for (const f of [sceneFile(id), sceneFile(id) + ".bak"]) if (fs.existsSync(f)) await trashFn(f);
}
function getLast() {
  return readState().last;
}
function setLast(id) {
  const s = readState();
  s.last = id;
  writeState(s);
}
const dir = () => DIR;
const winStateFile = () => path.join(electron.app.getPath("userData"), "window-state.json");
let flushed = false;
function createWindow() {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(winStateFile(), "utf8"));
  } catch {
  }
  const win = new electron.BrowserWindow({
    width: s.width ?? 1280,
    height: s.height ?? 800,
    x: s.x,
    y: s.y,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#121212",
    webPreferences: { preload: path.join(__dirname, "../preload/index.js") }
  });
  if (s.maximized ?? true) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    try {
      fs.writeFileSync(winStateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch {
    }
    if (!flushed) {
      e.preventDefault();
      win.webContents.send("flush");
      const done = () => {
        if (!flushed) {
          flushed = true;
          win.close();
        }
      };
      setTimeout(done, 1500);
      electron.ipcMain.once("flushed", done);
    }
  });
  if (!electron.app.isPackaged && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(__dirname, "../renderer/index.html"));
}
electron.app.whenReady().then(() => {
  init({ dir: path.join(electron.app.getPath("documents"), "ExcalidrawRay"), trash: (f) => electron.shell.trashItem(f) });
  electron.ipcMain.handle("projects:list", () => list());
  electron.ipcMain.handle("projects:create", (_e, name) => create(name));
  electron.ipcMain.handle("projects:load", (_e, id) => load(id));
  electron.ipcMain.handle("projects:save", (_e, id, json) => save(id, json));
  electron.ipcMain.handle("projects:rename", (_e, id, name) => rename(id, name));
  electron.ipcMain.handle("projects:delete", (_e, id) => remove(id));
  electron.ipcMain.handle("projects:last", () => getLast());
  electron.ipcMain.handle("projects:setLast", (_e, id) => setLast(id));
  electron.ipcMain.handle("projects:openFolder", () => electron.shell.openPath(dir()));
  createWindow();
});
electron.app.on("window-all-closed", () => electron.app.quit());
