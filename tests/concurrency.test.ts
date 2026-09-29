import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "../src/utils/concurrency";

test("mapWithConcurrency: ประมวลผลครบทุกตัว ผลลัพธ์เรียงตรงกับ input แม้เสร็จไม่เรียงกัน", async () => {
  // สลับเวลาทำงานจงใจ (ตัวแรกช้าสุด) เพื่อพิสูจน์ว่าผลลัพธ์ยังเรียงตาม input ไม่ใช่ตามลำดับที่เสร็จ
  const items = [30, 10, 20];
  const results = await mapWithConcurrency(items, 3, async (ms) => {
    await new Promise((r) => setTimeout(r, ms));
    return ms * 2;
  });
  assert.deepEqual(results, [60, 20, 40]);
});

test("mapWithConcurrency: ไม่เกิน limit ตัวทำงานพร้อมกัน ณ เวลาหนึ่ง", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);

  await mapWithConcurrency(items, 3, async (i) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return i;
  });

  assert.ok(maxInFlight <= 3, `ควรมีไม่เกิน 3 ตัวพร้อมกัน แต่พีคที่ ${maxInFlight}`);
});

test("mapWithConcurrency: limit มากกว่าจำนวน items ไม่พัง ทำงานปกติ", async () => {
  const results = await mapWithConcurrency([1, 2], 100, async (n) => n + 1);
  assert.deepEqual(results, [2, 3]);
});

test("mapWithConcurrency: array ว่างคืน array ว่างทันที", async () => {
  const results = await mapWithConcurrency<number, number>([], 5, async (n) => n);
  assert.deepEqual(results, []);
});

test("mapWithConcurrency: error จากตัวใดตัวหนึ่ง reject ออกไปทั้งชุด ไม่กลืนเงียบๆ", async () => {
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    })
  );
});
