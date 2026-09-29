/**
 * รัน fn กับทุกตัวใน items พร้อมกันไม่เกิน limit ตัว ณ เวลาหนึ่ง
 *
 * ใช้แทน for...of + await ทีละตัว ตอนที่ fn มี I/O ภายนอก (เขียน DB, ยิง push) เพราะทีละตัว
 * ที่คนไข้เยอะและเวลาชนกันเยอะ (เช่นทุกคนกินยาเช้าพร้อมกัน) จะทำให้ scheduler tick หนึ่งครั้ง
 * ใช้เวลานานกว่ารอบถัดไปที่จะมาถึง (ทุก 1 นาที) — แจ้งเตือนกินยาจะมาช้าลงเรื่อยๆ ตามจำนวนคนไข้
 *
 * ไม่ยิงพร้อมกันทั้งหมดในทีเดียว (Promise.all เดี่ยวๆ) เพราะจะยิง DB/Expo push API หนักเกินไป
 * พร้อมกันถ้าคนไข้เยอะมาก — limit ไว้เป็นเกราะกันเช่นเดียวกับที่คุมจำนวน connection พร้อมกัน
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
}
