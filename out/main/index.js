"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const zod = require("zod");
let _SQL = null;
async function getSqlJs() {
  if (_SQL) return _SQL;
  const initSqlJs = require("sql.js");
  _SQL = await initSqlJs();
  return _SQL;
}
class SqlJsStatement {
  constructor(sqlDb, sql) {
    this.sqlDb = sqlDb;
    this.sql = sql;
  }
  bindParams(params) {
    if (params.length === 1 && typeof params[0] === "object" && params[0] !== null && !Array.isArray(params[0])) {
      return params[0];
    }
    return params;
  }
  get(...params) {
    const stmt = this.sqlDb.prepare(this.sql);
    try {
      const bound = this.bindParams(params);
      stmt.bind(Array.isArray(bound) ? bound : []);
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return void 0;
    } finally {
      stmt.free();
    }
  }
  all(...params) {
    const stmt = this.sqlDb.prepare(this.sql);
    try {
      const bound = this.bindParams(params);
      stmt.bind(Array.isArray(bound) ? bound : []);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }
  run(...params) {
    const bound = this.bindParams(params);
    this.sqlDb.run(this.sql, Array.isArray(bound) ? bound : []);
    const changes = this.sqlDb.getRowsModified();
    const [{ "last_insert_rowid()": lastId }] = (this.sqlDb.exec("SELECT last_insert_rowid()")[0]?.values ?? [[0]]).map(
      (row) => ({ "last_insert_rowid()": row[0] })
    );
    return { changes, lastInsertRowid: lastId };
  }
}
class SqlJsDatabase {
  sqlDb;
  filePath;
  constructor(sqlDb, filePath) {
    this.sqlDb = sqlDb;
    this.filePath = filePath;
  }
  exec(sql) {
    this.sqlDb.run(sql);
    this.persist();
  }
  prepare(sql) {
    return new SqlJsStatement(this.sqlDb, sql);
  }
  pragma(clause) {
    try {
      this.sqlDb.run(`PRAGMA ${clause}`);
    } catch {
    }
  }
  transaction(fn) {
    return () => {
      this.sqlDb.run("BEGIN");
      try {
        const result = fn();
        this.sqlDb.run("COMMIT");
        this.persist();
        return result;
      } catch (err) {
        this.sqlDb.run("ROLLBACK");
        throw err;
      }
    };
  }
  close() {
    this.persist();
    this.sqlDb.close();
  }
  persist() {
    if (!this.filePath) return;
    const data = this.sqlDb.export();
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, Buffer.from(data));
  }
}
async function openSqlJsDatabase(filePath) {
  const SQL = await getSqlJs();
  let db;
  if (filePath !== ":memory:" && fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  return new SqlJsDatabase(db, filePath === ":memory:" ? null : filePath);
}
let _db = null;
async function initDb() {
  const dbPath = process.env.NODE_ENV === "test" ? ":memory:" : path.join(electron.app.getPath("userData"), "saqib-pos.db");
  const db = await openSqlJsDatabase(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  _db = db;
  return db;
}
function closeDb() {
  _db?.close();
  _db = null;
}
function getMigrationsDir() {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "migrations");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error("migrations/ directory not found");
}
function runMigrations(db) {
  const migrationsDir = getMigrationsDir();
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const migrationName = path.basename(file, ".sql");
    const id = parseInt(file.split("_")[0], 10);
    try {
      const row = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(id);
      if (row) continue;
    } catch {
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec(sql);
    console.log(`[migrate] Applied: ${migrationName}`);
  }
}
const is = {
  dev: !electron.app.isPackaged
};
({
  isWindows: process.platform === "win32",
  isMacOS: process.platform === "darwin",
  isLinux: process.platform === "linux"
});
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: "Saqib POS",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      // ARCHITECTURE.md §Security
      nodeIntegration: false,
      // ARCHITECTURE.md §Security
      sandbox: false
      // needed for preload to require electron APIs
    }
  });
  win.on("ready-to-show", () => {
    win.show();
  });
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
const PingInputSchema = zod.z.object({
  message: zod.z.string().min(1).max(200)
});
zod.z.object({
  echo: zod.z.string(),
  timestamp: zod.z.string()
});
function registerPingHandler() {
  electron.ipcMain.handle("ping:ping", (_event, rawInput) => {
    const parsed = PingInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      };
    }
    return {
      ok: true,
      data: {
        echo: parsed.data.message,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  });
}
process.on("uncaughtException", (err) => {
  console.error("[main] uncaughtException:", err.stack ?? err.message);
  electron.app.exit(1);
});
electron.app.whenReady().then(async () => {
  const db = await initDb();
  runMigrations(db);
  registerPingHandler();
  createWindow();
  electron.app.on("activate", () => {
    createWindow();
  });
}).catch((err) => {
  console.error("[main] startup error:", err.stack ?? err.message);
  electron.app.exit(1);
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    closeDb();
    electron.app.quit();
  }
});
electron.app.on("before-quit", () => {
  closeDb();
});
