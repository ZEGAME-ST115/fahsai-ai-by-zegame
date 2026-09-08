import pg from "pg";

const { Pool } = pg;

// Northflank (และ hosting Postgres ส่วนใหญ่) ให้ connection string ผ่าน env ตัวเดียว
// รูปแบบ: postgres://user:password@host:port/dbname
// SSL: บาง provider (Northflank รวมถึง) ต้องเปิด SSL แต่ certificate เป็น self-signed เลยต้องปิดการ verify
// Northflank สร้าง secret ชื่อ POSTGRES_URI ให้อัตโนมัติจาก addon (ไม่ใช่ DATABASE_URL)
// รองรับทั้งสองชื่อ เผื่อบาง provider อื่นใช้ DATABASE_URL แทน จะได้ไม่ต้องแก้โค้ดถ้าเปลี่ยน host ในอนาคต
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URI;
if (!connectionString) {
  throw new Error(
    "ไม่พบ DATABASE_URL หรือ POSTGRES_URI ใน environment variables — ต้อง link secret จาก Postgres addon เข้า service ก่อน"
  );
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      display_name TEXT,
      birthdate TEXT,        -- YYYY-MM-DD ที่ผู้ใช้กรอกเอง
      birthtime TEXT,        -- HH:MM (optional)
      birthplace TEXT,       -- ชื่อสถานที่เกิดตามที่ผู้ใช้พิมพ์ (optional)
      birth_lat DOUBLE PRECISION,   -- พิกัดจริงจาก geocoding (optional)
      birth_lon DOUBLE PRECISION,
      zodiac TEXT,            -- ราศีสุริยะ คำนวณจาก birthdate (fallback)
      natal_chart TEXT,       -- JSON ตำแหน่งดาวเคราะห์จริง ณ วันเกิด คำนวณครั้งเดียวตอนกรอกข้อมูลครบ
      pending_step TEXT,      -- ใช้ track ว่ากำลังถามอะไรอยู่ในบทสนทนา (เช่น 'ask_birthdate')
      subscribed BOOLEAN DEFAULT TRUE,  -- true = รับดวงประจำวันตอนเช้า, false = ปิดรับ
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // cache คำทำนาย: user คนเดียวกัน + โหมดเดียวกัน + วันเดียวกัน (เวลาไทย) ต้องได้ข้อความเดิมทุกครั้งที่กด
  // ไพ่ทาโรต์ไม่ cache เพราะโดยธรรมชาติควรสุ่มใหม่ได้ทุกครั้งที่ขอ
  await pool.query(`
    CREATE TABLE IF NOT EXISTS horoscope_cache (
      user_id TEXT NOT NULL,
      mode TEXT NOT NULL,        -- 'daily_push', 'overview', 'love', 'money', 'health', 'numerology'
      date_key TEXT NOT NULL,    -- YYYY-MM-DD ตามเวลาไทย ของวันที่ทำนาย
      reading TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id, mode, date_key)
    );
  `);
}

// ต้องรอ init ให้เสร็จก่อน query แรกจริงๆ ถึงจะปลอดภัย — เก็บ promise ไว้ให้ทุกฟังก์ชัน await ก่อนใช้ pool
const ready = init().catch((err) => {
  console.error("DB init ล้มเหลว:", err);
  throw err;
});

export async function getCachedReading(userId, mode, dateKey) {
  await ready;
  const { rows } = await pool.query(
    "SELECT reading FROM horoscope_cache WHERE user_id = $1 AND mode = $2 AND date_key = $3",
    [userId, mode, dateKey]
  );
  return rows[0]?.reading ?? null;
}

export async function saveCachedReading(userId, mode, dateKey, reading) {
  await ready;
  await pool.query(
    `INSERT INTO horoscope_cache (user_id, mode, date_key, reading) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, mode, date_key) DO UPDATE SET reading = excluded.reading`,
    [userId, mode, dateKey, reading]
  );
}

export async function upsertUserBasic(userId, displayName) {
  await ready;
  await pool.query(
    `INSERT INTO users (user_id, display_name, pending_step) VALUES ($1, $2, 'ask_birthdate')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, displayName || null]
  );
}

// map ชื่อคอลัมน์ snake_case ในฐานข้อมูล กลับเป็น camelCase ให้โค้ดส่วนอื่น (server.js/ai.js) ใช้เหมือนเดิมทุกที่ ไม่ต้องแก้ที่เรียกใช้
function toCamelUser(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    displayName: row.display_name,
    birthdate: row.birthdate,
    birthtime: row.birthtime,
    birthplace: row.birthplace,
    birthLat: row.birth_lat,
    birthLon: row.birth_lon,
    zodiac: row.zodiac,
    natalChart: row.natal_chart,
    pendingStep: row.pending_step,
    subscribed: row.subscribed,
    createdAt: row.created_at,
  };
}

export async function getUser(userId) {
  await ready;
  const { rows } = await pool.query("SELECT * FROM users WHERE user_id = $1", [userId]);
  return toCamelUser(rows[0]);
}

export async function setPendingStep(userId, step) {
  await ready;
  await pool.query("UPDATE users SET pending_step = $1 WHERE user_id = $2", [step, userId]);
}

export async function saveBirthdate(userId, birthdate, zodiac) {
  await ready;
  await pool.query(
    "UPDATE users SET birthdate = $1, zodiac = $2, pending_step = 'ask_birthtime' WHERE user_id = $3",
    [birthdate, zodiac, userId]
  );
}

export async function saveBirthtime(userId, birthtime) {
  await ready;
  await pool.query(
    "UPDATE users SET birthtime = $1, pending_step = 'ask_birthplace' WHERE user_id = $2",
    [birthtime, userId]
  );
}

export async function skipBirthtime(userId) {
  await ready;
  await pool.query("UPDATE users SET pending_step = 'ask_birthplace' WHERE user_id = $1", [userId]);
}

export async function saveBirthplace(userId, birthplace, lat, lon) {
  await ready;
  await pool.query(
    "UPDATE users SET birthplace = $1, birth_lat = $2, birth_lon = $3, pending_step = NULL WHERE user_id = $4",
    [birthplace, lat, lon, userId]
  );
}

export async function skipBirthplace(userId) {
  await ready;
  await pool.query("UPDATE users SET pending_step = NULL WHERE user_id = $1", [userId]);
}

export async function saveNatalChart(userId, natalChartJson) {
  await ready;
  await pool.query("UPDATE users SET natal_chart = $1 WHERE user_id = $2", [natalChartJson, userId]);
}

export async function setSubscribed(userId, subscribed) {
  await ready;
  await pool.query("UPDATE users SET subscribed = $1 WHERE user_id = $2", [subscribed, userId]);
}

export async function getAllSubscribedUsersWithBirthdate() {
  await ready;
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE subscribed = TRUE AND birthdate IS NOT NULL"
  );
  return rows.map(toCamelUser);
}

export default pool;
