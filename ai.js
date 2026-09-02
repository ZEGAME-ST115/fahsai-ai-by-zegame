import { computeNatalPositions, computeTransitPositions, findActiveAspects } from "./astro.js";
import { getCachedReading, saveCachedReading } from "./db.js";

const AI_PROVIDER = (process.env.AI_PROVIDER || "gemini").toLowerCase(); // "gemini" (ฟรี) หรือ "anthropic" (เสียเงิน)

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

async function callClaude(system, userPrompt, maxTokens = 800) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

async function callGemini(system, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const doRequest = () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      }),
    });

  let res = await doRequest();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 8000));
    res = await doRequest();
  }
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n");
  if (!text) throw new Error(`Gemini API: ไม่มี text กลับมา — ${JSON.stringify(data)}`);
  return text.trim();
}

async function callAI(system, userPrompt) {
  if (AI_PROVIDER === "anthropic") return callClaude(system, userPrompt);
  return callGemini(system, userPrompt);
}

// ราศีสุริยะแบบง่าย ใช้เป็น fallback ตอนที่ยังไม่มีเวลาเกิด/สถานที่เกิดสำหรับคำนวณ natal chart เต็มรูปแบบ
export function computeZodiac(birthdateStr) {
  const [, m, d] = birthdateStr.split("-").map(Number);
  const zodiacList = [
    [20, "มังกร"], [19, "กุมภ์"], [21, "มีน"], [20, "เมษ"],
    [21, "พฤษภ"], [21, "เมถุน"], [23, "กรกฎ"], [23, "สิงห์"],
    [23, "กันย์"], [23, "ตุลย์"], [22, "พิจิก"], [22, "ธนู"],
  ];
  const idx = d <= zodiacList[m - 1][0] ? (m + 10) % 12 : (m + 11) % 12;
  return zodiacList[idx][1];
}

/**
 * คำนวณ natal chart จริงจากวันเกิด (+เวลาถ้ามี) แล้วคืนเป็น JSON string สำหรับเก็บใน DB
 * เรียกครั้งเดียวตอนผู้ใช้กรอกข้อมูลครบ ไม่ต้องคำนวณซ้ำทุกครั้งที่ทำนาย
 */
export function buildNatalChart(birthdate, birthtime) {
  const timePart = birthtime || "12:00"; // ถ้าไม่ทราบเวลาเกิด ใช้เที่ยงวันเป็นค่ากลาง (มาตรฐานสากลเมื่อไม่ทราบเวลาจริง)
  const dateUTC = new Date(`${birthdate}T${timePart}:00+07:00`); // สมมติป้อนเป็นเวลาไทย
  const positions = computeNatalPositions(dateUTC);
  return JSON.stringify({ positions, hasExactTime: Boolean(birthtime) });
}

// สร้างสรุปข้อความจากตำแหน่งดาว ให้ AI ใช้อ้างอิงตรงๆ (AI ห้ามคิดตัวเลขเอง)
function formatPositions(positions) {
  return positions.map((p) => `- ${p.label}: ราศี${p.sign} (${p.degree}°)`).join("\n");
}

function formatAspects(aspects) {
  if (!aspects.length) return "- ไม่มี aspect สำคัญที่ orb แคบพอในวันนี้";
  return aspects
    .map((a) => `- ${a.transitPlanet} ทำมุม ${a.aspect} กับ ${a.natalPlanet} เดิม (ห่างจากมุมพอดี ${a.orb}°) → ลักษณะ: ${a.nature}`)
    .join("\n");
}

// วันที่ปัจจุบันตามเวลาไทย ใช้เป็น key ของ cache — ข้ามวันเมื่อไหร่ค่อยคำนวณใหม่ ไม่ใช่ทุกครั้งที่กด
function todayKeyBangkok() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" }); // sv-SE ให้ format YYYY-MM-DD ตรงๆ
}

const SYSTEM_PROMPT = `คุณเป็นนักโหราศาสตร์สากล (Western Astrology) มืออาชีพ วิเคราะห์จาก "ข้อมูลตำแหน่งดาวจริง" ที่ให้ไปเท่านั้น
กฎเหล็ก (ห้ามฝ่าฝืน):
- ห้ามอ้างตำแหน่งดาว ราศี หรือ aspect ที่ไม่ได้อยู่ในข้อมูลที่ให้มา ห้ามสมมติหรือแต่งขึ้นเอง
- ตีความจากข้อมูลจริงที่ให้เท่านั้น เชื่อมโยงความหมายเชิงโหราศาสตร์ แต่ตัวเลข/ตำแหน่ง/ชื่อ aspect ต้องตรงกับข้อมูลที่ให้เป๊ะ
- สำคัญมาก: ห้ามเข้าข้างว่าดวงต้องดีเสมอ ให้บอกตรงไปตรงมาว่าวันนี้มีความท้าทายจริงๆ ในเรื่องไหน ห้ามเปลี่ยนให้ฟังดูดีเกินจริงหรือกลบด้วยคำบวกจนเสียความหมายจริง ส่วนถ้าดวงราบรื่น ก็บอกตามจริงว่าราบรื่นได้เต็มที่เช่นกัน
- ตอบเป็นภาษาไทย ที่มีความแม่นยำ กระชับ แบ่งหัวข้อชัดเจน ขึ้นบรรทัดใหม่ทุกหัวข้อ ใส่อีโมจิหน้าหัวข้อให้เข้ากับเนื้อหา (ใช้ ⚠️ หรือ 🔻 กับหัวข้อที่ผลไม่ดี ไม่ต้องฝืนใช้อีโมจิบวกกับเรื่องลบ)
- แต่ละหัวข้อยาวไม่เกิน 2 ประโยค ห้ามเขียนพารากราฟยาว
- ปิดท้ายทุกครั้งด้วย 3 บรรทัดนี้ (คำนวณให้สอดคล้องกับราศี/ตำแหน่งดาวจริงของคนนั้น ไม่สุ่มลอยๆ — ค่าพวกนี้ต้องนิ่ง ไม่เปลี่ยนไปมาถ้าข้อมูลตำแหน่งดาวเดิม):
  🎨 สีมงคล: <สี ที่สอดคล้องกับธาตุ/ราศีของดาวเด่นในข้อมูล>
  🔢 เลขมงคล: <ตัวเลข 1-2 หลัก>
  📌 คำแนะนำวันนี้: <คำแนะนำสั้น ปฏิบัติได้จริง ถ้าดวงไม่ดีให้แนะนำวิธีรับมือ ไม่ใช่คำปลอบใจลอยๆ>
- ห้ามพยากรณ์เรื่องความตาย อุบัติเหตุร้ายแรง หรือเนื้อหาที่ทำให้ตื่นตระหนกเกินเหตุ (บอกความท้าทายได้ แต่ไม่ใช้ถ้อยคำสร้างความหวาดกลัว)
- อย่าระบุว่าเป็น AI ให้เข้ากับบทบาทนักโหราศาสตร์ตลอดข้อความ`;

/**
 * ประกอบ context ข้อมูลจริง (natal + transit + aspect) เป็น string เดียวใส่ท้ายพรอมต์ทุกโหมด
 * นี่คือส่วนที่ทำให้ AI "ทำนายจากข้อมูลจริง" แทนที่จะเดาเอง
 */
function buildRealDataContext(user) {
  const natal = user.natalChart ? JSON.parse(user.natalChart) : null;
  if (!natal) {
    // ยังไม่มี natal chart คำนวณไว้ (เช่นข้อมูลเก่าก่อนอัปเดตระบบ) — ใช้ราศีสุริยะอย่างเดียว บอก AI ตรงๆ ว่าข้อมูลจำกัด
    return `⚠️ มีเฉพาะราศีสุริยะ (${user.zodiac}) ยังไม่มีตำแหน่งดาวเต็มรูปแบบ ให้ทำนายแบบราศีสุริยะทั่วไป อย่าอ้างดาวเคราะห์ดวงอื่นที่ไม่มีข้อมูล`;
  }

  const transitDate = new Date();
  const transitPositions = computeTransitPositions(transitDate);
  const aspects = findActiveAspects(natal.positions, transitPositions);

  return `ตำแหน่งดาวเกิด (natal, ${natal.hasExactTime ? "คำนวณจากเวลาเกิดจริง" : "ไม่ทราบเวลาเกิดแน่ชัด ใช้เที่ยงวันเป็นค่ากลาง ความแม่นยำของราศีย่อยอาจคลาดเคลื่อนได้บ้าง"}):
${formatPositions(natal.positions)}

ตำแหน่งดาวปัจจุบัน (transit ณ วันนี้):
${formatPositions(transitPositions)}

Aspect ที่กำลังเกิดขึ้นจริงระหว่างดาว transit กับดาวเกิด (เรียงจากมีผลแรงสุด):
${formatAspects(aspects)}`;
}

/**
 * สร้างดวงประจำวัน สำหรับ push ทุกเช้า — อิงจาก transit + aspect จริงของวันนั้น
 * cache ตาม (userId, 'daily_push', วันที่วันนี้) — เรียกกี่ครั้งในวันเดียวกันก็ได้ข้อความเดิม
 */
export async function generateDailyHoroscope(user) {
  const dateKey = todayKeyBangkok();
  const cached = getCachedReading(user.userId, "daily_push", dateKey);
  if (cached) return cached;

  const today = new Date().toLocaleDateString("th-TH", {
    year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Bangkok",
  });
  const prompt = `ทำนายดวงประจำวันนี้ (${today}) :

${buildRealDataContext(user)}

โครงสร้างที่ต้องใช้ (ใส่อีโมจิหน้าแต่ละหัวข้อ ขึ้นบรรทัดใหม่ทุกหัวข้อ):
💫 ภาพรวมวันนี้ (อ้างอิง aspect ที่มีผลแรงที่สุด)
💼 การงาน
💰 การเงิน
💕 ความรัก
⚠️ ข้อควรระวัง
แล้วปิดท้ายด้วยสีมงคล/เลขมงคล/คำแนะนำตามกติกา`;
  const reading = await callAI(SYSTEM_PROMPT, prompt);
  saveCachedReading(user.userId, "daily_push", dateKey, reading);
  return reading;
}

const MODE_PROMPTS = {
  overview: (u) => `ทำนายดวงภาพรวมจากข้อมูลตำแหน่งดาวจริงต่อไปนี้:\n\n${buildRealDataContext(u)}\n\nโครงสร้าง: 💫 ภาพรวม / 💼 การงาน / 💰 การเงิน / 💕 ความรัก แต่ละหัวข้อขึ้นบรรทัดใหม่ อ้างอิง aspect ที่ให้มาจริง แล้วปิดท้ายด้วยสีมงคล/เลขมงคล/คำแนะนำ`,
  love: (u) => `ทำนายดวงความรักจากข้อมูลตำแหน่งดาวจริงต่อไปนี้ (เน้นดาวศุกร์และดวงจันทร์):\n\n${buildRealDataContext(u)}\n\nโครงสร้าง: 💕 ภาพรวมความรัก / 💌 คนมีคู่ / 💘 คนโสด แต่ละหัวข้อขึ้นบรรทัดใหม่ แล้วปิดท้ายด้วยสีมงคล/เลขมงคล/คำแนะนำ`,
  money: (u) => `ทำนายดวงการเงิน/การงานจากข้อมูลตำแหน่งดาวจริงต่อไปนี้ (เน้นดาวพฤหัสบดีและเสาร์):\n\n${buildRealDataContext(u)}\n\nโครงสร้าง: 💰 การเงิน / 💼 การงาน / 📈 โอกาส แต่ละหัวข้อขึ้นบรรทัดใหม่ แล้วปิดท้ายด้วยสีมงคล/เลขมงคล/คำแนะนำ`,
  tarot: (u) => `สุ่มไพ่ทาโรต์ 1 ใบ ตีความให้เชื่อมโยงกับข้อมูลตำแหน่งดาวจริงต่อไปนี้:\n\n${buildRealDataContext(u)}\n\nโครงสร้าง: 🃏 ไพ่ที่สุ่มได้ (บอกชื่อไพ่) / 🔮 ความหมาย / ✨ สิ่งที่ไพ่ใบนี้บอกกับชีวิตช่วงนี้ (เชื่อมกับ aspect จริง) แล้วปิดท้ายด้วยสีมงคล/เลขมงคล/คำแนะนำ`,
  numerology: (u) => `วิเคราะห์เลขศาสตร์จากวันเกิด ${u.birthdate} ประกอบกับข้อมูลตำแหน่งดาวจริงต่อไปนี้:\n\n${buildRealDataContext(u)}\n\nโครงสร้าง: 🔢 เลขชีวิต (คำนวณจากผลรวมวันเกิด) / 📖 ความหมายของเลขนี้ / 🌟 จุดแข็งที่ควรใช้ในช่วงนี้ (เชื่อมกับตำแหน่งดาว) แล้วปิดท้ายด้วยสีมงคล/เลขมงคล/คำแนะนำ`,
};

const CACHEABLE_MODES = new Set(["overview", "love", "money", "numerology"]); // tarot ไม่ cache เพราะควรสุ่มใหม่ทุกครั้งโดยธรรมชาติ

/**
 * สร้างคำทำนายตามโหมดที่ผู้ใช้เลือกจากเมนู
 * โหมดที่ไม่ใช่ tarot จะ cache ตามวันเดียวกัน — กดซ้ำกี่ครั้งในวันเดียวกันได้ข้อความเดิมเป๊ะ
 */
export async function generateHoroscopeByMode(user, mode) {
  const dateKey = todayKeyBangkok();

  if (CACHEABLE_MODES.has(mode)) {
    const cached = getCachedReading(user.userId, mode, dateKey);
    if (cached) return cached;
  }

  const buildPrompt = MODE_PROMPTS[mode] || MODE_PROMPTS.overview;
  const reading = await callAI(SYSTEM_PROMPT, buildPrompt(user));

  if (CACHEABLE_MODES.has(mode)) {
    saveCachedReading(user.userId, mode, dateKey, reading);
  }

  return reading;
}
