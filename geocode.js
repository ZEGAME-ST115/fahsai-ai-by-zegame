/**
 * แปลงชื่อสถานที่เกิด (เช่น "กรุงเทพมหานคร", "เชียงใหม่", "Bangkok") เป็นพิกัด lat/long จริง
 * ใช้ Open-Meteo Geocoding API — ฟรี ไม่ต้องสมัคร ไม่ต้องมี API key
 * https://open-meteo.com/en/docs/geocoding-api
 */
export async function geocodePlace(placeName) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    placeName
  )}&count=1&language=th&format=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding API error ${res.status}`);

  const data = await res.json();
  const result = data.results?.[0];
  if (!result) return null;

  return {
    name: result.name,
    country: result.country,
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone,
  };
}
