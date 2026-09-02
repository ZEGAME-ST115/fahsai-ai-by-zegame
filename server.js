import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import { Client, middleware } from "@line/bot-sdk";
import cron from "node-cron";
import {
  upsertUserBasic,
  getUser,
  setPendingStep,
  saveBirthdate,
  saveBirthtime,
  skipBirthtime,
  saveBirthplace,
  skipBirthplace,
  saveNatalChart,
  setSubscribed,
  getAllSubscribedUsersWithBirthdate,
} from "./db.js";
import { computeZodiac, buildNatalChart, generateDailyHoroscope, generateHoroscopeByMode } from "./ai.js";
import { geocodePlace } from "./geocode.js";

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(lineConfig);
const app = express();

// เมนูให้เลือกโหมดดูดวง แสดงเป็นปุ่มลัดใต้ข้อความตอบกลับ
const MODE_QUICK_REPLY = {
  items: [
    { type: "action", action: { type: "message", label: "ดวงวันนี้", text: "ดวงวันนี้" } },
    { type: "action", action: { type: "message", label: "ดวงความรัก", text: "ดวงความรัก" } },
    { type: "action", action: { type: "message", label: "ดวงการเงิน", text: "ดวงการเงิน" } },
    { type: "action", action: { type: "message", label: "ไพ่ทาโรต์", text: "ไพ่ทาโรต์" } },
    { type: "action", action: { type: "message", label: "เลขศาสตร์", text: "เลขศาสตร์" } },
  ],
};

const TEXT_TO_MODE = {
  "ดวงวันนี้": "overview",
  "ดวงความรัก": "love",
  "ดวงการเงิน": "money",
  "ไพ่ทาโรต์": "tarot",
  "เลขศาสตร์": "numerology",
};

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/; // รูปแบบ YYYY-MM-DD
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/; // รูปแบบ HH:MM
const SKIP_BIRTHTIME_TEXT = "ไม่ระบุเวลาเกิด";
const SKIP_BIRTHPLACE_TEXT = "ไม่ระบุสถานที่เกิด";

// จำกัดจำนวน request ต่อ IP กัน spam/DoS เข้า webhook (LINE ยิงจริงไม่เกินนี้อยู่แล้วในสถานการณ์ปกติ)
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// สำคัญ: middleware(lineConfig) ต้องมาก่อน express.json() เพื่อ verify signature จาก raw body ให้ถูกต้อง
app.post("/webhook", webhookLimiter, middleware(lineConfig), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

app.get("/", (_req, res) => res.send("LINE horoscope bot is running"));

async function handleEvent(event) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === "follow") {
    const profile = await client.getProfile(userId).catch(() => null);
    upsertUserBasic(userId, profile?.displayName);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `สวัสดีค่ะ ${profile?.displayName || ""} 🔮\nก่อนเริ่มดูดวง รบกวนพิมพ์วันเกิดของคุณในรูปแบบ YYYY-MM-DD เช่น 1998-05-20`,
    });
  }

  if (event.type === "unfollow") {
    setSubscribed(userId, false);
    return;
  }

  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.trim();
  const user = getUser(userId);

  // ยังไม่เคยมีในระบบ (เช่น ข้อความแรกก่อน follow event มาถึง) -> สร้าง record ก่อน
  if (!user) {
    upsertUserBasic(userId, null);
  }

  const current = getUser(userId);

  // ขั้นตอนถามวันเกิดครั้งแรก
  if (current.pendingStep === "ask_birthdate" || (!current.birthdate && current.pendingStep !== "ask_birthtime")) {
    const match = text.match(DATE_RE);
    if (!match) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "รบกวนพิมพ์วันเกิดในรูปแบบ YYYY-MM-DD นะคะ เช่น 1998-05-20",
      });
    }
    const [, y, m, d] = match;
    const birthdate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    const zodiac = computeZodiac(birthdate);
    saveBirthdate(userId, birthdate, zodiac);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `บันทึกแล้วค่ะ ✨ คุณราศี${zodiac}\nถ้าทราบเวลาเกิดด้วย พิมพ์มาในรูปแบบ HH:MM (เช่น 14:30) จะช่วยให้ทำนายได้เจาะจงขึ้น หรือกด "${SKIP_BIRTHTIME_TEXT}" ก็ได้ค่ะ`,
      quickReply: { items: [{ type: "action", action: { type: "message", label: SKIP_BIRTHTIME_TEXT, text: SKIP_BIRTHTIME_TEXT } }] },
    });
  }

  // ขั้นตอนถามเวลาเกิด (optional)
  if (current.pendingStep === "ask_birthtime") {
    if (text === SKIP_BIRTHTIME_TEXT) {
      skipBirthtime(userId);
    } else {
      const match = text.match(TIME_RE);
      if (!match) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `รบกวนพิมพ์เวลาเกิดในรูปแบบ HH:MM นะคะ เช่น 14:30 หรือกด "${SKIP_BIRTHTIME_TEXT}"`,
          quickReply: { items: [{ type: "action", action: { type: "message", label: SKIP_BIRTHTIME_TEXT, text: SKIP_BIRTHTIME_TEXT } }] },
        });
      }
      saveBirthtime(userId, `${match[1].padStart(2, "0")}:${match[2]}`);
    }
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `ทราบสถานที่เกิดไหมคะ (เช่น กรุงเทพมหานคร, เชียงใหม่) ช่วยให้คำนวณตำแหน่งดาวแม่นยำขึ้น หรือกด "${SKIP_BIRTHPLACE_TEXT}" ก็ได้ค่ะ`,
      quickReply: { items: [{ type: "action", action: { type: "message", label: SKIP_BIRTHPLACE_TEXT, text: SKIP_BIRTHPLACE_TEXT } }] },
    });
  }

  // ขั้นตอนถามสถานที่เกิด (optional) — จบแล้วคำนวณ natal chart จริงครั้งเดียวเก็บไว้
  if (current.pendingStep === "ask_birthplace") {
    let lat = null, lon = null, placeLabel = null;
    if (text !== SKIP_BIRTHPLACE_TEXT) {
      const geo = await geocodePlace(text).catch(() => null);
      if (!geo) {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `หาสถานที่ "${text}" ไม่เจอค่ะ ลองพิมพ์ชื่อจังหวัด/เมืองอีกครั้ง หรือกด "${SKIP_BIRTHPLACE_TEXT}"`,
          quickReply: { items: [{ type: "action", action: { type: "message", label: SKIP_BIRTHPLACE_TEXT, text: SKIP_BIRTHPLACE_TEXT } }] },
        });
      }
      lat = geo.latitude;
      lon = geo.longitude;
      placeLabel = `${geo.name}, ${geo.country}`;
      saveBirthplace(userId, placeLabel, lat, lon);
    } else {
      skipBirthplace(userId);
    }

    // คำนวณ natal chart จริงจากข้อมูลที่มี (วันเกิดจำเป็นต้องมีแล้วตอนนี้)
    const updated = getUser(userId);
    const natalChartJson = buildNatalChart(updated.birthdate, updated.birthtime);
    saveNatalChart(userId, natalChartJson);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "คำนวณตำแหน่งดาวเรียบร้อยค่ะ 🔮✨ ทุกเช้าจะมีดวงประจำวันจากข้อมูลจริงส่งมาให้อัตโนมัติ หรือจะเลือกดูโหมดอื่นได้จากเมนูด้านล่างเลยค่ะ",
      quickReply: MODE_QUICK_REPLY,
    });
  }

  // เลือกโหมดจากเมนู
  const mode = TEXT_TO_MODE[text];
  if (mode) {
    const reading = await generateHoroscopeByMode(current, mode);
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: reading,
      quickReply: MODE_QUICK_REPLY,
    });
  }

  // ข้อความอื่น ๆ ที่ไม่ตรงเมนู -> โชว์เมนูอีกครั้ง
  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "เลือกดูดวงแบบไหนดีคะ วันนี้พิมพ์อะไรก็ได้ หรือกดเลือกจากเมนูด้านล่าง 👇",
    quickReply: MODE_QUICK_REPLY,
  });
}

// ── ส่งดวงประจำวันทุกเช้าอัตโนมัติ ──────────────────────────────
const hour = Number(process.env.DAILY_PUSH_HOUR ?? 7);
const minute = Number(process.env.DAILY_PUSH_MINUTE ?? 0);
// cron format: นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์
const pushDelayMs = Number(process.env.DAILY_PUSH_DELAY_MS ?? 5000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

cron.schedule(
  `${minute} ${hour} * * *`,
  async () => {
    const users = getAllSubscribedUsersWithBirthdate();
    console.log(`[daily-push] ส่งดวงประจำวันให้ ${users.length} คน`);
    for (const user of users) {
      try {
        const text = await generateDailyHoroscope(user);
        await client.pushMessage(user.userId, { type: "text", text });
      } catch (err) {
        // ผู้ใช้คนหนึ่ง error ไม่ควรทำให้ทั้ง loop หยุด
        console.error(`push ล้มเหลวสำหรับ ${user.userId}:`, err.message);
      }
      // หน่วงเวลาระหว่างแต่ละคน กัน rate limit ของ AI provider ฟรีเทียร์ (ตั้งค่าได้ผ่าน DAILY_PUSH_DELAY_MS)
      await sleep(pushDelayMs);
    }
  },
  { timezone: "Asia/Bangkok" }
);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
