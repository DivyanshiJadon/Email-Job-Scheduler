import fs from "fs";
import path from "path";
import nodemailer, { Transporter } from "nodemailer";
import { config } from "../config";
import { logInfo, logWarn } from "../utils/logger";

export interface Mailbox {
  email: string;
  user: string;
  pass: string;
  host: string;
  port: number;
  name: string;
}

export interface SendResult {
  messageId: string;
  response: string;
  etherealUrl?: string;
  accepted: string[];
  rejected: string[];
}

const cachePath = path.resolve(__dirname, "../../.ethereal-accounts.json");

const transporterCache = new Map<string, Transporter>();

/**
 * Ethereal is a fake SMTP sandbox. Accounts are provisioned lazily and
 * cached on disk so restarts reuse the same mailbox instead of creating a
 * fresh one every boot. If ETHEREAL_HOST is set in env, those exact
 * credentials are used (useful when a shared demo mailbox is wanted).
 */
export async function provisionSenderPool(size: number): Promise<Mailbox[]> {
  if (config.smtp.host && config.smtp.user && config.smtp.pass) {
    const base: Mailbox = {
      email: config.smtp.from ?? config.smtp.user,
      user: config.smtp.user,
      pass: config.smtp.pass,
      host: config.smtp.host,
      port: config.smtp.port,
      name: "ReachInbox",
    };
    return Array.from({ length: size }, (_, i) => ({
      ...base,
      name: `ReachInbox ${i + 1}`,
    }));
  }

  const cached = readCache();
  const uniq = (m: Mailbox) => m.user;
  const deduped = Array.from(new Map(cached.map((m) => [uniq(m), m])).values());
  const need = size - deduped.length;
  if (need > 0) {
    logInfo("ethereal", `provisioning ${need} new Ethereal account(s)`);
    // Ethereal can return the same account when rapidly called; space calls
    // out and de-duplicate so each "sender" really is a distinct mailbox.
    let attempts = 0;
    while (deduped.length < size && attempts < size * 4) {
      attempts++;
      try {
        const account = await nodemailer.createTestAccount();
        if (deduped.some((m) => uniq(m) === account.user)) {
          await sleep(1500);
          continue;
        }
        deduped.push({
          email: account.user,
          user: account.user,
          pass: account.pass,
          host: account.smtp.host,
          port: account.smtp.port,
          name: `ReachInbox ${deduped.length + 1}`,
        });
        logInfo("ethereal", `created test account ${account.user} (view mail at https://ethereal.email)`);
        await sleep(1500);
      } catch (err) {
        logWarn("ethereal", "createTestAccount failed; reusing any cached accounts", err);
        break;
      }
    }
    writeCache(deduped);
  }
  return deduped.slice(0, size);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getMailboxUrl(mailbox: Mailbox, messageId: string): string {
  // Ethereal's "view message" URL uses the base64 of the message id.
  try {
    const b64 = Buffer.from(messageId.replace(/[<>]/g, "")).toString("base64");
    return `https://ethereal.email/message/${b64}`;
  } catch {
    return `https://ethereal.email`;
  }
}

export function getTransporterFor(mailbox: Mailbox): Transporter {
  const cached = transporterCache.get(mailbox.email);
  if (cached) return cached;
  const transporter = nodemailer.createTransport({
    host: mailbox.host,
    port: mailbox.port,
    secure: false,
    auth: { user: mailbox.user, pass: mailbox.pass },
    tls: { rejectUnauthorized: false },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });
  transporterCache.set(mailbox.email, transporter);
  return transporter;
}

export async function sendViaMailbox(
  mailbox: Mailbox,
  opts: { to: string; subject: string; html: string }
): Promise<SendResult> {
  const transporter = getTransporterFor(mailbox);
  const info = await transporter.sendMail({
    from: `"${mailbox.name}" <${mailbox.email}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.html.replace(/<[^>]*>/g, ""),
  });

  return {
    messageId: info.messageId,
    response: info.response,
    etherealUrl: getMailboxUrl(mailbox, info.messageId),
    accepted: info.accepted ?? [],
    rejected: info.rejected ?? [],
  };
}

function readCache(): Mailbox[] {
  try {
    const raw = fs.readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Mailbox[];
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* no cache yet */
  }
  return [];
}

function writeCache(accounts: Mailbox[]): void {
  try {
    fs.writeFileSync(cachePath, JSON.stringify(accounts, null, 2));
  } catch (err) {
    logWarn("ethereal", "failed to write account cache", err);
  }
}