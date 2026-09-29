/**
 * เวลาทั้งหมดในระบบตีความตามเวลาประเทศไทย ไม่ใช่ UTC
 *
 * ผู้ป่วยกรอก wake_time / sleep_time และหมอกรอก scheduled_times ของยาเป็นเวลาไทยเสมอ
 * ถ้าตีความค่าพวกนั้นเป็น UTC ทุกฟีเจอร์ที่อิงเวลาจะคลาดไป 7 ชั่วโมง — เตือนกินยา 07:00
 * จะไปเด้งตอนบ่ายสอง ซึ่งกับพาร์กินสันที่เวลากินยาสำคัญทางคลินิกถือว่ารับไม่ได้
 *
 * ใช้ offset ตายตัวได้เพราะประเทศไทยเป็น UTC+7 ตลอดปี ไม่มี daylight saving — ค่านี้จึง
 * "ถูกต้องแน่นอน" ไม่ใช่การประมาณ และไม่ต้องพึ่งไลบรารี timezone
 *
 * ⚠️ ถ้าวันหนึ่งต้องรองรับผู้ป่วยนอกประเทศไทย วิธีนี้จะใช้ไม่ได้ ต้องเพิ่มคอลัมน์ timezone
 *    ต่อผู้ป่วยแล้วคำนวณรายคนแทน (โซนที่มี DST ใช้ offset คงที่ไม่ได้)
 */

/** Asia/Bangkok = UTC+7 คงที่ */
const APP_UTC_OFFSET_MINUTES = 7 * 60;
const OFFSET_MS = APP_UTC_OFFSET_MINUTES * 60_000;

/**
 * เลื่อน Date ไปข้างหน้าตาม offset เพื่อให้ฟิลด์ getUTC* ของมันอ่านออกมาเป็นเวลาไทย
 * ใช้เฉพาะตอนต้องการดึงวัน/เดือน/ปี/วันในสัปดาห์ ตามปฏิทินไทย — ตัว Date ที่ได้ไม่ใช่เวลาจริง
 */
function toAppLocal(date: Date): Date {
  return new Date(date.getTime() + OFFSET_MS);
}

/** ประกอบวันที่ของ "วันนี้ตามปฏิทินไทย" เข้ากับเวลา ("HH:MM" หรือ "HH:MM:SS") ที่เป็นเวลาไทย */
export function todayAt(time: string, base: Date = new Date()): Date {
  const [h, m, s] = time.split(":").map(Number);
  const local = toAppLocal(base);
  const wallClock = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m, s ?? 0);
  // wallClock คือเวลาไทยที่ต้องการ แต่ยังอยู่ในรูป UTC — ถอย offset กลับเพื่อให้เป็นเวลาจริง
  return new Date(wallClock - OFFSET_MS);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** [start, end) */
export function isWithin(date: Date, start: Date, end: Date): boolean {
  return date.getTime() >= start.getTime() && date.getTime() < end.getTime();
}

/** วันที่ตามปฏิทินไทยในรูป YYYY-MM-DD */
export function dateOnly(date: Date): string {
  return toAppLocal(date).toISOString().slice(0, 10);
}

/** End of an explicit Bangkok calendar date. */
export function endOfAppDate(date: string): Date {
  return new Date(`${date}T23:59:59.999+07:00`);
}

/** 23:59:59.999 ของวันนั้นตามปฏิทินไทย */
export function endOfDay(base: Date = new Date()): Date {
  const local = toAppLocal(base);
  const wallClock = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 23, 59, 59, 999);
  return new Date(wallClock - OFFSET_MS);
}

/** วันในสัปดาห์ตามปฏิทินไทย รูปแบบ ISO — 1 = จันทร์ ถึง 7 = อาทิตย์ */
export function appWeekday(date: Date): number {
  return ((toAppLocal(date).getUTCDay() + 6) % 7) + 1;
}
