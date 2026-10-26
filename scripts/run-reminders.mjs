// Lanza manualmente (o desde un cron del sistema) el envío de recordatorios.
// Uso: MYTIME_URL=https://tu-dominio CRON_SECRET=... npm run reminders
const url = process.env.MYTIME_URL ?? "http://127.0.0.1:3100";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("Falta CRON_SECRET.");
  process.exit(1);
}
const res = await fetch(`${url}/api/cron/reminders`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
console.log(res.status, await res.text());
process.exit(res.ok ? 0 : 1);
