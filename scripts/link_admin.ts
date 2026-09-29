/**
 * ผูกบัญชี admin ที่มีอยู่แล้วเข้ากับ Supabase Auth
 *
 * admin คนแรกถูกสร้างด้วย seed/gen_admin.mjs ซึ่งเก็บแต่ password_hash ไม่มี auth_uid
 * จึงล็อกอินผ่านเว็บ staff (ที่ใช้ Supabase Auth) ไม่ได้ สคริปต์นี้สร้างบัญชีใน Supabase Auth
 * ให้แล้วเขียน auth_uid กลับไปที่แถวเดิม
 *
 * หลังรันเสร็จ admin ล็อกอินได้ทั้งสองทาง — ทางเดิมด้วย user_name/รหัสเก่า และทางใหม่ด้วย
 * อีเมล/รหัสใหม่ผ่านเว็บ ซึ่งเป็นสิ่งที่ต้องการระหว่างช่วงเปลี่ยนผ่าน
 *
 *   npx tsx scripts/link_admin.ts                  ถามอีเมลและรหัสผ่านแบบไม่แสดงบนจอ
 *   npx tsx scripts/link_admin.ts --user-name xxx  ผูกบัญชีอื่นที่ไม่ใช่ "admin"
 *
 * รันซ้ำได้ปลอดภัย — ถ้าแถวนั้นมี auth_uid อยู่แล้วจะไม่ทำอะไร
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { supabase } from "../src/config/supabaseClient";

function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    if (hidden) {
      (rl as unknown as { _writeToOutput: (c: string) => void })._writeToOutput = (chunk: string) => {
        if (!muted) process.stdout.write(chunk);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const nameIndex = argv.indexOf("--user-name");
  const userName = nameIndex === -1 ? "admin" : argv[nameIndex + 1];
  if (!userName) fail("ไม่ได้ระบุค่าให้ --user-name");

  console.log(`\n  ผูกบัญชี "${userName}" เข้ากับ Supabase Auth\n`);

  const { data: user, error } = await supabase
    .from("users")
    .select("id, user_name, role, auth_uid, is_active")
    .eq("user_name", userName)
    .maybeSingle();

  if (error) fail(`อ่านฐานข้อมูลไม่ได้: ${error.message}`);
  if (!user) fail(`ไม่พบผู้ใช้ "${userName}" ใน pdlife.users`);
  if (user.auth_uid) {
    console.log(`  บัญชีนี้ผูกกับ Supabase Auth อยู่แล้ว (auth_uid = ${user.auth_uid})`);
    console.log("  ไม่ต้องทำอะไรเพิ่ม\n");
    return;
  }

  console.log(`  พบแล้ว: role = ${user.role} · is_active = ${user.is_active}\n`);

  const email = await prompt("  อีเมลที่จะใช้ล็อกอินเข้าเว็บ: ");
  if (!email.includes("@")) fail("อีเมลไม่ถูกต้อง");

  const password = await prompt("  ตั้งรหัสผ่านสำหรับเว็บ (ไม่แสดงตัวอักษร): ", true);
  if (Buffer.byteLength(password, "utf8") < 8) fail("รหัสผ่านต้องยาวอย่างน้อย 8 ไบต์");
  const confirm = await prompt("  พิมพ์อีกครั้งเพื่อยืนยัน: ", true);
  if (password !== confirm) fail("รหัสสองครั้งไม่ตรงกัน — ไม่ได้สร้างอะไรทั้งนั้น");

  const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    fail(`สร้างบัญชีใน Supabase Auth ไม่ได้: ${created.error?.message ?? "unknown"}`);
  }
  const authUid = created.data.user.id;

  const { error: updateError } = await supabase.from("users").update({ auth_uid: authUid }).eq("id", user.id);
  if (updateError) {
    // ย้อนกลับ ไม่ปล่อยให้เหลือบัญชี Supabase ที่ไม่ได้ผูกกับใคร
    await supabase.auth.admin.deleteUser(authUid);
    fail(`เขียน auth_uid ไม่สำเร็จ (ลบบัญชี Supabase ที่เพิ่งสร้างทิ้งแล้ว): ${updateError.message}`);
  }

  console.log(`
  ✅ ผูกเรียบร้อย

     user_name : ${user.user_name}
     email     : ${email}
     auth_uid  : ${authUid}

  ตอนนี้ล็อกอินได้ทั้งสองทาง:
    - ทางเดิม  : user_name + รหัสเดิม ผ่าน POST /api/auth/login
    - ทางใหม่  : อีเมล + รหัสที่เพิ่งตั้ง ผ่านเว็บ staff (Supabase Auth)
`);
}

main().catch((err) => {
  console.error("\n  สคริปต์ล้ม:", err);
  process.exit(1);
});
