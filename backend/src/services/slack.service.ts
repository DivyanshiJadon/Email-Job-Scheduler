import { randomBytes } from "crypto";
import { config } from "../config";
import { AppDataSource } from "../db/typeorm";
import { SlackIntegration } from "../db/entities/SlackIntegration";
import { logError, logInfo, logWarn } from "../utils/logger";

const SLACK_API = "https://slack.com/api";

export function buildSlackAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.slack.clientId ?? "",
    scope: "chat:write,incoming-webhook",
    redirect_uri: config.slack.redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export function generateState(): string {
  return randomBytes(24).toString("hex");
}

export interface SlackTokenResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id: string; name: string };
  authed_user?: { id: string };
  bot_user_id?: string;
}

export async function exchangeCodeForToken(code: string): Promise<SlackTokenResponse> {
  const params = new URLSearchParams({
    client_id: config.slack.clientId ?? "",
    client_secret: config.slack.clientSecret ?? "",
    code,
    redirect_uri: config.slack.redirectUri,
  });

  const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return (await res.json()) as SlackTokenResponse;
}

export async function saveIntegration(
  userId: string,
  tokenData: SlackTokenResponse,
  channel: string
): Promise<SlackIntegration> {
  const repo = AppDataSource.getRepository(SlackIntegration);
  let integration = await repo.findOne({ where: { userId } });
  if (!integration) {
    integration = repo.create({ userId });
  }
  integration.teamId = tokenData.team?.id ?? "unknown";
  integration.teamName = tokenData.team?.name ?? "Slack workspace";
  integration.channel = channel;
  integration.accessToken = tokenData.access_token ?? "";
  integration.botUserId = tokenData.bot_user_id ?? null;
  integration.active = true;
  return repo.save(integration);
}

export async function disconnectSlack(userId: string): Promise<void> {
  const repo = AppDataSource.getRepository(SlackIntegration);
  const integration = await repo.findOne({ where: { userId } });
  if (!integration) return;
  integration.active = false;
  await repo.save(integration);
}

export async function getSlackStatus(userId: string): Promise<{
  connected: boolean;
  teamName?: string;
  channel?: string;
}> {
  const repo = AppDataSource.getRepository(SlackIntegration);
  const integration = await repo.findOne({ where: { userId, active: true } });
  if (!integration) return { connected: false };
  return { connected: true, teamName: integration.teamName, channel: integration.channel };
}

/**
 * Posts a real message to the user's Slack workspace channel the moment a
 * sender's hourly limit is reached. If the user has not connected Slack,
 * this is a silent no-op (never crashes the worker).
 */
export async function notifyRateLimitHit(payload: {
  userId: string | undefined | null;
  senderId: string;
  senderEmail?: string;
  recipient?: string;
  channel: string;
  limit: number;
  retryAt: Date;
  message: string;
}): Promise<boolean> {
  if (!payload.userId) return false;

  const repo = AppDataSource.getRepository(SlackIntegration);
  let integration: SlackIntegration | null = null;
  try {
    integration = await repo.findOne({ where: { userId: payload.userId, active: true } });
  } catch (err) {
    logError("slack", "failed to look up integration", err);
    return false;
  }

  if (!integration || !integration.accessToken) {
    logWarn("slack", "rate limit hit but Slack not connected; skipping notification", {
      userId: payload.userId,
      senderId: payload.senderId,
    });
    return false;
  }

  const text = [
    `:rotating_light: *ReachInbox: hourly rate limit reached*`,
    `Sender: \`${payload.senderEmail ?? payload.senderId}\``,
    `Limit: ${payload.limit} emails/hour (sender).`,
    `Email to \`${payload.recipient ?? "—"}\` deferred until the next hour window (~${payload.retryAt.toISOString()}).`,
    payload.message,
  ].join("\n");

  try {
    const body = new URLSearchParams({
      channel: integration.channel || payload.channel,
      text,
      username: "ReachInbox Alerts",
    });

    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${integration.accessToken}`,
      },
      body: body.toString(),
    });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (!json.ok) {
      logWarn("slack", "chat.postMessage failed", { error: json.error });
      return false;
    }
    logInfo("slack", "sent rate-limit alert to Slack", { channel: integration.channel });
    return true;
  } catch (err) {
    logError("slack", "chat.postMessage threw", err);
    return false;
  }
}

export async function listSlackChannels(token: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const res = await fetch(`${SLACK_API}/conversations.list?limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as { ok: boolean; channels?: Array<{ id: string; name: string }> };
    return json.ok ? (json.channels ?? []) : [];
  } catch {
    return [];
  }
}