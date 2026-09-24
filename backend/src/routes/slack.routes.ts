import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requireAuth } from "../middleware/auth.middleware";
import { config } from "../config";
import {
  buildSlackAuthUrl,
  exchangeCodeForToken,
  generateState,
  getSlackStatus,
  saveIntegration,
  disconnectSlack,
  listSlackChannels,
} from "../services/slack.service";
import { AppDataSource } from "../db/typeorm";
import { SlackIntegration } from "../db/entities/SlackIntegration";
import { logError } from "../utils/logger";

const router = Router();

interface SlackState {
  sub: string;
  iat: number;
  exp: number;
}

function signSlackState(userId: string): string {
  return jwt.sign({ sub: userId }, config.auth.jwtSecret, { expiresIn: "10m" });
}

function verifySlackState(state: string): SlackState | null {
  try {
    return jwt.verify(state, config.auth.jwtSecret) as SlackState;
  } catch {
    return null;
  }
}

router.get("/connect", requireAuth, (req: Request, res: Response) => {
  const state = signSlackState(req.auth!.sub);
  const url = buildSlackAuthUrl(state);
  res.json({ url, state });
});

router.get("/oauth/callback", async (req: Request, res: Response) => {
  const code = (req.query.code as string) ?? "";
  const state = (req.query.state as string) ?? "";
  const parsed = verifySlackState(state);

  if (!parsed) {
    return res.redirect(`${config.frontendUrl}/dashboard?slack=error`);
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    if (!tokenData.ok) {
      logError("slack", "token exchange failed", { error: tokenData.error });
      return res.redirect(`${config.frontendUrl}/dashboard?slack=error`);
    }
    // Prefer the channel the user installed the app into (req scopes ask for it);
    // fall back to the configured default channel.
    const channel = config.slack.channel ?? "#general";
    await saveIntegration(parsed.sub, tokenData, channel);
    res.redirect(`${config.frontendUrl}/dashboard?slack=connected`);
  } catch (err) {
    logError("slack", "oauth callback failed", err);
    res.redirect(`${config.frontendUrl}/dashboard?slack=error`);
  }
});

router.get("/status", requireAuth, async (req: Request, res: Response) => {
  const status = await getSlackStatus(req.auth!.sub);
  res.json(status);
});

router.post("/disconnect", requireAuth, async (req: Request, res: Response) => {
  await disconnectSlack(req.auth!.sub);
  res.json({ ok: true });
});

router.get("/channels", requireAuth, async (req: Request, res: Response) => {
  try {
    const repo = AppDataSource.getRepository(SlackIntegration);
    const integration = await repo.findOne({ where: { userId: req.auth!.sub, active: true } });
    if (!integration) return res.json([]);
    const channels = await listSlackChannels(integration.accessToken);
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "failed" });
  }
});

export default router;