import Database from "better-sqlite3";

// ไฟล์ฐานข้อมูล SQLite เก็บอยู่ในเครื่อง/โฮสต์เดียวกับแอป (ไม่ต้องตั้งเซิร์ฟเวอร์ DB แยก)
// หมายเหตุ: ถ้า deploy บน hosting ที่ filesystem เป็น ephemeral (เช่น Render free / Vercel serverless)
// ข้อมูลจะหายเมื่อ redeploy — ให้ใช้ disk แบบ persistent (Render Disk, Railway Volume) หรือย้ายไป Postgres ภายหลัง
const db = new Database(process.env.DB_PATH || "./data.sqlite");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    userId TEXT PRIMARY KEY,
    displayName TEXT,
    birthdate TEXT,        -- YYYY-MM-DD ที่ผู้ใช้กรอกเอง
    birthtime TEXT,        -- HH:MM (optional)
    birthplace TEXT,       -- ชื่อสถานที่เกิดตามที่ผู้ใช้พิมพ์ (optional)
    birthLat REAL,         -- พิกัดจริงจาก geocoding (optional)
    birthLon REAL,
    zodiac TEXT,           -- ราศีสุริยะ คำนวณจาก birthdate (fallback)
    natalChart TEXT,       -- JSON ตำแหน่งดาวเคราะห์จริง ณ วันเกิด คำนวณครั้งเดียวตอนกรอกข้อมูลครบ
    pendingStep TEXT,      -- ใช้ track ว่ากำลังถามอะไรอยู่ในบทสนทนา (เช่น 'ask_birthdate')
    subscribed INTEGER DEFAULT 1,  -- 1 = รับดวงประจำวันตอนเช้า, 0 = ปิดรับ
    createdAt TEXT DEFAULT (datetime('now'))
  );
`);

// migration แบบเบาๆ สำหรับ DB ที่สร้างไว้ก่อนมีคอลัมน์ใหม่ (ไม่พังถ้าคอลัมน์มีอยู่แล้ว)
const existingCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
for (const [col, type] of [
  ["birthplace", "TEXT"], ["birthLat", "REAL"], ["birthLon", "REAL"], ["natalChart", "TEXT"],
]) {
  if (!existingCols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
}

// cache คำทำนาย: user คนเดียวกัน + โหมดเดียวกัน + วันเดียวกัน (เวลาไทย) ต้องได้ข้อความเดิมทุกครั้งที่กด
// ไพ่ทาโรต์ไม่ cache เพราะโดยธรรมชาติควรสุ่มใหม่ได้ทุกครั้งที่ขอ
db.exec(`
  CREATE TABLE IF NOT EXISTS horoscope_cache (
    userId TEXT NOT NULL,
    mode TEXT NOT NULL,        -- 'daily_push', 'overview', 'love', 'money', 'numerology'
    dateKey TEXT NOT NULL,     -- YYYY-MM-DD ตามเวลาไทย ของวันที่ทำนาย
    reading TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (userId, mode, dateKey)
  );
`);

export function getCachedReading(userId, mode, dateKey) {
  const row = db
    .prepare("SELECT reading FROM horoscope_cache WHERE userId = ? AND mode = ? AND dateKey = ?")
    .get(userId, mode, dateKey);
  return row?.reading ?? null;
}

export function saveCachedReading(userId, mode, dateKey, reading) {
  db.prepare(
    `INSERT INTO horoscope_cache (userId, mode, dateKey, reading) VALUES (?, ?, ?, ?)
     ON CONFLICT(userId, mode, dateKey) DO UPDATE SET reading = excluded.reading`
  ).run(userId, mode, dateKey, reading);
}

export function upsertUserBasic(userId, displayName) {
  const exists = db.prepare("SELECT 1 FROM users WHERE userId = ?").get(userId);
  if (!exists) {
    db.prepare(
      "INSERT INTO users (userId, displayName, pendingStep) VALUES (?, ?, 'ask_birthdate')"
    ).run(userId, displayName || null);
  }
}

export function getUser(userId) {
  return db.prepare("SELECT * FROM users WHERE userId = ?").get(userId);
}

export function getAllUsers() {
  return db.prepare("SELECT * FROM users ORDER BY createdAt DESC").all();
}

export function setPendingStep(userId, step) {
  db.prepare("UPDATE users SET pendingStep = ? WHERE userId = ?").run(step, userId);
}

export function saveBirthdate(userId, birthdate, zodiac) {
  db.prepare(
    "UPDATE users SET birthdate = ?, zodiac = ?, pendingStep = 'ask_birthtime' WHERE userId = ?"
  ).run(birthdate, zodiac, userId);
}

export function saveBirthtime(userId, birthtime) {
  db.prepare("UPDATE users SET birthtime = ?, pendingStep = 'ask_birthplace' WHERE userId = ?").run(
    birthtime,
    userId
  );
}

export function skipBirthtime(userId) {
  db.prepare("UPDATE users SET pendingStep = 'ask_birthplace' WHERE userId = ?").run(userId);
}

export function saveBirthplace(userId, birthplace, lat, lon) {
  db.prepare(
    "UPDATE users SET birthplace = ?, birthLat = ?, birthLon = ?, pendingStep = NULL WHERE userId = ?"
  ).run(birthplace, lat, lon, userId);
}

export function skipBirthplace(userId) {
  db.prepare("UPDATE users SET pendingStep = NULL WHERE userId = ?").run(userId);
}

export function saveNatalChart(userId, natalChartJson) {
  db.prepare("UPDATE users SET natalChart = ? WHERE userId = ?").run(natalChartJson, userId);
}

export function setSubscribed(userId, subscribed) {
  db.prepare("UPDATE users SET subscribed = ? WHERE userId = ?").run(subscribed ? 1 : 0, userId);
}

export function getAllSubscribedUsersWithBirthdate() {
  return db
    .prepare("SELECT * FROM users WHERE subscribed = 1 AND birthdate IS NOT NULL")
    .all();
}

export default db;

