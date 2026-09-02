import * as Astronomy from "astronomy-engine";

const ZODIAC_SIGNS = [
  "เมษ", "พฤษภ", "เมถุน", "กรกฎ", "สิงห์", "กันย์",
  "ตุลย์", "พิจิก", "ธนู", "มังกร", "กุมภ์", "มีน",
];

// แปลงลองจิจูดสุริยวิถี (0-360 องศา) เป็นราศี
function eclipticLonToSign(lon) {
  const normalized = ((lon % 360) + 360) % 360;
  const idx = Math.floor(normalized / 30);
  const degreeInSign = (normalized % 30).toFixed(1);
  return { sign: ZODIAC_SIGNS[idx], degree: Number(degreeInSign) };
}

// คำนวณลองจิจูดสุริยวิถีของวัตถุท้องฟ้า ณ เวลาที่กำหนด (geocentric ecliptic longitude)
function getEclipticLongitude(body, date) {
  const eq = Astronomy.Equator(body, date, new Astronomy.Observer(0, 0, 0), false, true);
  const ecl = Astronomy.Ecliptic(eq.vec);
  return ecl.elon;
}

const PLANETS = [
  { key: "sun", th: "อาทิตย์ (ตัวตน/แก่นแท้)", body: Astronomy.Body.Sun },
  { key: "moon", th: "จันทร์ (อารมณ์/จิตใจ)", body: Astronomy.Body.Moon },
  { key: "mercury", th: "พุธ (การสื่อสาร/ความคิด)", body: Astronomy.Body.Mercury },
  { key: "venus", th: "ศุกร์ (ความรัก/ความสัมพันธ์)", body: Astronomy.Body.Venus },
  { key: "mars", th: "อังคาร (พลัง/แรงขับ)", body: Astronomy.Body.Mars },
  { key: "jupiter", th: "พฤหัสบดี (โชคลาภ/การขยาย)", body: Astronomy.Body.Jupiter },
  { key: "saturn", th: "เสาร์ (อุปสรรค/บททดสอบ)", body: Astronomy.Body.Saturn },
];

/**
 * คำนวณตำแหน่งดาวเคราะห์จริง ณ วันเวลาที่ระบุ (UTC)
 * คืนค่าตำแหน่งราศีของดาวแต่ละดวง + เกร็ดที่ AI ใช้ตีความได้ (ไม่ใช่ AI แต่งเอง)
 */
export function computeNatalPositions(dateUTC) {
  const positions = PLANETS.map((p) => {
    const lon = getEclipticLongitude(p.body, dateUTC);
    const { sign, degree } = eclipticLonToSign(lon);
    return { key: p.key, label: p.th, sign, degree };
  });
  return positions;
}

/**
 * คำนวณตำแหน่งดาวเคราะห์ ณ ตอนนี้ (transit) สำหรับใช้ทำนายดวงประจำวัน
 * เทียบกับตำแหน่งดาวเกิด (natal) เพื่อหา aspect จริงที่กำลังเกิดขึ้น
 */
export function computeTransitPositions(dateUTC = new Date()) {
  return computeNatalPositions(dateUTC);
}

// มุมสัมพันธ์ (aspect) หลักที่ใช้ในโหราศาสตร์สากล พร้อมค่า orb (ความคลาดเคลื่อนที่ยอมรับได้)
const ASPECTS = [
  { name: "Conjunction (สมพงศ์)", angle: 0, orb: 8, nature: "รวมพลัง" },
  { name: "Sextile (เกื้อหนุน)", angle: 60, orb: 6, nature: "เอื้อประโยชน์" },
  { name: "Square (ตึงเครียด)", angle: 90, orb: 6, nature: "ท้าทาย" },
  { name: "Trine (ราบรื่น)", angle: 120, orb: 8, nature: "ราบรื่น" },
  { name: "Opposition (ตรงข้าม)", angle: 180, orb: 8, nature: "ดึงดันสองขั้ว" },
];

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * หา aspect จริงระหว่างดาว transit (วันนี้) กับดาว natal (วันเกิด)
 * นี่คือแก่นของการ "ทำนายดวงประจำวัน" แบบมีหลักโหราศาสตร์จริงรองรับ ไม่ใช่ค่าที่ AI สุ่มเดา
 */
export function findActiveAspects(natalPositions, transitPositions) {
  const results = [];
  for (const t of transitPositions) {
    for (const n of natalPositions) {
      const transitLon = signToAbsoluteLon(t);
      const natalLon = signToAbsoluteLon(n);
      const diff = angleDiff(transitLon, natalLon);
      for (const asp of ASPECTS) {
        if (Math.abs(diff - asp.angle) <= asp.orb) {
          results.push({
            transitPlanet: t.label,
            natalPlanet: n.label,
            aspect: asp.name,
            nature: asp.nature,
            orb: Math.abs(diff - asp.angle).toFixed(1),
          });
        }
      }
    }
  }
  // เรียงตาม orb (ยิ่งใกล้ 0 ยิ่งมีผลแรง) เอาแค่ 5 อันดับแรกกันพรอมต์ยาวเกิน
  return results.sort((a, b) => a.orb - b.orb).slice(0, 5);
}

function signToAbsoluteLon(p) {
  return ZODIAC_SIGNS.indexOf(p.sign) * 30 + p.degree;
}

export { ZODIAC_SIGNS };
