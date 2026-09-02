# LINE Horoscope Bot — คู่มือติดตั้งฉบับละเอียด

บอทนี้ทำ 2 อย่าง:
1. ตอบแชท: ผู้ใช้เลือกโหมดดูดวง (ดวงวันนี้ / ความรัก / การเงิน / ไพ่ทาโรต์ / เลขศาสตร์) แล้ว AI (Claude) ทำนายให้ทันที
2. Push อัตโนมัติทุกเช้า: ดึงรายชื่อผู้ใช้ทั้งหมดที่กรอกวันเกิดไว้แล้ว จากนั้นสร้างคำทำนายเฉพาะบุคคลและส่งเข้าไลน์ให้ทีละคน

---

## ขั้นตอนที่ 1 — สร้าง LINE Official Account + Messaging API Channel

1. เข้า https://developers.line.biz/console/ แล้วล็อกอินด้วยบัญชี LINE
2. สร้าง **Provider** ใหม่ (ตั้งชื่ออะไรก็ได้ เช่น ชื่อบริษัท/แบรนด์)
3. ในหน้า Provider เลือก **Create a Messaging API channel**
   - กรอกชื่อ, คำอธิบาย, หมวดหมู่ (เลือก "หมอดู/โหราศาสตร์" หรือใกล้เคียง), อีเมล
4. เข้าไปที่แท็บ **Messaging API** ของ channel ที่สร้าง แล้วเก็บค่า 2 ตัวนี้ไว้:
   - **Channel access token** (กด Issue เพื่อสร้าง long-lived token)
   - **Channel secret** (อยู่ในแท็บ Basic settings)
5. ในแท็บ Messaging API:
   - **ปิด** "Auto-reply messages" และ "Greeting messages" (ไม่งั้นจะชนกับบอทที่เราจะเขียนเอง)
   - **เปิด** "Use webhook" ไว้ก่อน (ยังไม่ต้องใส่ URL จนกว่าจะ deploy เสร็จในขั้นตอนที่ 5)
6. เพิ่มเพื่อน LINE OA ของตัวเองด้วย QR Code ที่อยู่ในหน้า channel เพื่อไว้ทดสอบ

---

## ขั้นตอนที่ 2 — เตรียมโค้ดในเครื่อง

```bash
cd line-horoscope-bot
npm install
cp .env.example .env
```

เปิดไฟล์ `.env` แล้วกรอก:
- `LINE_CHANNEL_ACCESS_TOKEN` และ `LINE_CHANNEL_SECRET` จากขั้นตอนที่ 1
- `AI_PROVIDER=gemini` (ค่าเริ่มต้น ใช้ฟรี) หรือ `AI_PROVIDER=anthropic` (เสียเงินตาม token แต่คุณภาพสูงกว่า)
- ถ้าใช้ Gemini: `GEMINI_API_KEY` — ขอฟรีได้ที่ https://aistudio.google.com/apikey (ล็อกอิน Google ธรรมดา ไม่ต้องผูกบัตร กด Create API key ได้เลย)
- ถ้าใช้ Anthropic: `ANTHROPIC_API_KEY` จาก https://console.anthropic.com/settings/keys (ต้องเติมเครดิต)
- `DAILY_PUSH_HOUR` / `DAILY_PUSH_MINUTE` เวลาที่จะส่งดวงทุกเช้า (ค่าเริ่มต้น 07:00 เวลาไทย)
- `DAILY_PUSH_DELAY_MS` ระยะหน่วงระหว่างส่งแต่ละคนตอนเช้า — **สำคัญมากถ้าใช้ Gemini ฟรี** เพราะฟรีเทียร์จำกัดจำนวนครั้ง/นาทีค่อนข้างต่ำ (ประมาณ 10-15 ครั้ง/นาที ขึ้นกับรุ่นโมเดล เช็คตัวเลขล่าสุดที่ https://ai.google.dev/gemini-api/docs/rate-limits) ค่าเริ่มต้น 5000ms (ผู้ใช้ 100 คน จะใช้เวลาส่งรวม ~8 นาที) ถ้าใช้ Anthropic paid ตั้งเป็น 0 ได้เลย

### ทำไมค่าเริ่มต้นเป็น Gemini
Gemini API ให้โควตาใช้ฟรีรายวันแบบไม่ต้องผูกบัตรเครดิต เหมาะกับการเริ่มทำ MVP วันนี้โดยไม่มีค่าใช้จ่ายด้าน AI เลย ข้อแลกเปลี่ยนคือ RPM ต่ำ (ใช้กับ user จำนวนมากพร้อมกันไม่ได้) และคุณภาพคำทำนายอาจไม่ประณีตเท่า Claude — ถ้าบอทเริ่มมีผู้ใช้จริงเยอะขึ้นค่อยสลับ `AI_PROVIDER=anthropic` ได้ทันทีโดยไม่ต้องแก้โค้ด

รันทดสอบในเครื่อง:
```bash
npm start
```
ถ้าขึ้น `Server running on port 3000` แปลว่าเซิร์ฟเวอร์พร้อมแล้ว

---

## ขั้นตอนที่ 3 — ทดสอบ webhook ในเครื่องด้วย ngrok (ก่อน deploy จริง)

1. ติดตั้ง ngrok: https://ngrok.com/download แล้วรัน
   ```bash
   ngrok http 3000
   ```
2. copy URL แบบ `https://xxxx.ngrok-free.app` ที่ได้
3. กลับไปที่ LINE Developers Console > แท็บ Messaging API > ช่อง Webhook URL ใส่
   `https://xxxx.ngrok-free.app/webhook` แล้วกด **Verify** ต้องขึ้น Success
4. เพิ่มเพื่อนบอทแล้วลองพิมพ์คุยดู ควรได้รับข้อความถามวันเกิด

---

## ขั้นตอนที่ 4 — ตรรกะการเก็บข้อมูลผู้ใช้ (สำคัญ ต้องเข้าใจก่อนใช้จริง)

LINE **ไม่ได้ส่งวันเกิดผู้ใช้มาให้อัตโนมัติ** ตอนแอดเพื่อน — API `getProfile` คืนแค่ userId, displayName, รูปโปรไฟล์, statusMessage เท่านั้น
ดังนั้นบอทนี้ถามวันเกิดจากผู้ใช้เองในแชทตอนแอดเพื่อนครั้งแรก (ดู `server.js` → event `follow`) แล้วเก็บลง SQLite (`data.sqlite`) พร้อมคำนวณราศีให้อัตโนมัติ (`ai.js` → `computeZodiac`)

ถ้าต้องการข้อมูลเพิ่ม (เวลาเกิด, เพศ, สไตล์การทำนายที่ชอบ) ให้ขยาย flow ถาม-ตอบใน `server.js` และเพิ่มคอลัมน์ใน `db.js` ได้เลย หรือจะทำเป็นฟอร์มสวย ๆ ผ่าน **LIFF (LINE Front-end Framework)** แทนการพิมพ์คุยก็ได้ (ขั้นสูงกว่า ไม่จำเป็นสำหรับ MVP วันนี้)

---

## ขั้นตอนที่ 5 — Deploy ขึ้นเซิร์ฟเวอร์จริง (ต้องมี HTTPS สาธารณะตลอดเวลา)

ต้องเลือก hosting ที่รันเซิร์ฟเวอร์ค้างไว้ตลอด (ไม่ใช่ serverless function ธรรมดา) เพราะ cron job ต้องรันเองตอนตี 7 ทุกวัน ตัวเลือกที่เร็วที่สุดสำหรับทำวันนี้:

**Railway.app** (แนะนำ เร็วสุด):
1. Push โค้ดขึ้น GitHub repo
2. เข้า railway.app > New Project > Deploy from GitHub repo
3. ใส่ Environment Variables ทั้งหมดจาก `.env` ในหน้า Variables ของ Railway
4. เพิ่ม **Volume** แล้ว mount ไปที่ path ที่เก็บ `data.sqlite` (ไม่งั้นข้อมูลผู้ใช้จะหายทุกครั้งที่ deploy ใหม่)
5. Railway จะให้ URL แบบ `https://your-app.up.railway.app` มา

จากนั้นกลับไปที่ LINE Developers Console เปลี่ยน Webhook URL เป็น
`https://your-app.up.railway.app/webhook` แล้วกด Verify อีกครั้ง

(ทางเลือกอื่น: Render.com ก็ทำแบบเดียวกันได้ — ใช้ Web Service + Persistent Disk)

---

## ขั้นตอนที่ 6 — ทดสอบ end-to-end

1. เพิ่มเพื่อนบอทจากมือถือ → ตอบวันเกิด → ต้องได้ราศีกลับมาพร้อมเมนู
2. ลองกดปุ่ม "ดวงวันนี้" / "ไพ่ทาโรต์" ฯลฯ → ต้องได้คำทำนายจาก AI
3. ทดสอบ cron โดยลดค่า `DAILY_PUSH_HOUR/MINUTE` ใน env ให้ตรงกับอีก 2 นาทีข้างหน้า แล้ว restart server เพื่อดูว่า push message เข้าจริง แล้วค่อยเปลี่ยนกลับเป็น 07:00

---

## ค่าใช้จ่ายที่ต้องรู้ก่อนใช้งานจริง (ข้อมูล ณ ปี 2026)

**LINE Official Account** มีโควตาจำนวนข้อความที่ส่งแบบ Push/Multicast/Broadcast ต่อเดือน (ข้อความตอบกลับในแชท/reply ไม่นับโควตานี้):
- แพ็กเกจ **Free**: ส่งข้อความบรอดแคสต์ได้ 300 ข้อความ/เดือน ไม่สามารถซื้อข้อความส่วนเกินเพิ่มได้ ต้องอัปเกรดแพ็กเกจ — พอทดสอบหรือมีผู้ติดตามน้อยกว่า ~300 คนใช้ push วันละครั้ง
- แพ็กเกจ **Basic**: 1,280 บาทต่อเดือน ส่งได้สูงสุด 15,000 ข้อความต่อเดือน ค่าข้อความเกินเพิ่มเติมข้อความละ 0.10 บาท
- แพ็กเกจ **Pro**: 1,780 บาทต่อเดือน ส่งได้สูงสุด 35,000 ข้อความต่อเดือน

สำคัญ: การ push ดวงประจำวัน 1 ครั้ง = ผู้ติดตาม 1 คน = 1 ข้อความในโควตา ดังนั้นถ้ามีผู้ติดตาม 500 คน และ push ทุกเช้า จะใช้ ~15,000 ข้อความ/เดือน ต้องใช้แพ็กเกจ Basic ขึ้นไป — ราคายังไม่รวม VAT 7%

**Anthropic API (Claude)**: คิดตามจำนวน token ที่ใช้จริง (pay-as-you-go) แยกจากค่า Claude.ai รายเดือน ต้องเติมเครดิตในบัญชี console.anthropic.com ก่อนเรียก API ได้ — ราคาต่อ token เช็คล่าสุดได้ที่ https://docs.claude.com

**Hosting**: Railway/Render มี free tier จำกัดชั่วโมงรันต่อเดือน ถ้าใช้งานจริงต่อเนื่องแนะนำอัปเกรดเป็นแพ็กเกจเสียเงินระดับเริ่มต้น (ราคาหลักร้อยบาท/เดือน)

---

## ไฟล์ในโปรเจกต์นี้

| ไฟล์ | หน้าที่ |
|---|---|
| `server.js` | Express server, รับ webhook, คุยกับผู้ใช้, ตั้ง cron ส่งดวงเช้า |
| `db.js` | จัดการฐานข้อมูล SQLite เก็บ userId/วันเกิด/ราศี |
| `ai.js` | เรียก Claude API สร้างคำทำนาย + คำนวณราศี |
| `.env.example` | template ตัวแปรที่ต้องตั้งค่า |

## ขั้นต่อไปที่ควรทำ (ไม่จำเป็นสำหรับวันนี้ แต่ควรทำถ้าจะใช้งานจริง)
- ทำ Rich Menu ให้กดเลือกโหมดง่ายกว่าพิมพ์ (ตั้งค่าใน LINE Official Account Manager หรือ Messaging API)
- ย้ายจาก SQLite ไป PostgreSQL ถ้าผู้ใช้เยอะ/ต้อง scale หลาย instance
- เพิ่มปุ่ม "หยุดรับดวงประจำวัน" ที่เรียก `setSubscribed(userId, false)`
- Rate-limit การเรียก Claude API ถ้าผู้ใช้เยอะมาก (เรียกพร้อมกันตอน cron ทำงาน อาจโดน rate limit ของ Anthropic — ใส่ delay เล็กน้อยระหว่าง loop หรือแบ่ง batch)
