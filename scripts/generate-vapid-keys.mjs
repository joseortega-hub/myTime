// Genera las claves VAPID (avisos push), el CRON_SECRET y el MYTIME_SESSION_SECRET.
// Copia la salida a tu .env (o a las variables del servidor). No las subas a Git.
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY="${publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${privateKey}"`);
console.log(`VAPID_SUBJECT="mailto:tu-correo@example.com"`);
console.log(`CRON_SECRET="${randomBytes(32).toString("base64url")}"`);
console.log(`MYTIME_SESSION_SECRET="${randomBytes(48).toString("base64url")}"`);
