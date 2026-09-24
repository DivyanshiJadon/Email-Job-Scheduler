import { Router, Request, Response, NextFunction } from "express";
import passport from "passport";
import { config } from "../config";
import { googleOAuthConfigured, signToken } from "../services/auth.service";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

const googleScopes: Array<"profile" | "email"> = ["profile", "email"];

router.get("/google", (req, res, next) => {
  if (!googleOAuthConfigured()) {
    return res.redirect(`${config.frontendUrl}/login?error=not_configured`);
  }
  passport.authenticate("google", {
    scope: googleScopes,
    session: false,
    prompt: "select_account",
  })(req, res, next);
});

router.get(
  "/google/callback",
  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate(
      "google",
      { session: false },
      (err: Error | null, user?: Express.User) => {
        if (err) {
          console.error("[auth] google callback error:", err.message);
          return res.redirect(`${config.frontendUrl}/login?error=google_failed`);
        }
        if (!user) {
          return res.redirect(`${config.frontendUrl}/login?error=google_denied`);
        }
        try {
          const token = signToken(user as never);
          return res.redirect(`${config.frontendUrl}/auth?token=${encodeURIComponent(token)}`);
        } catch (signErr) {
          console.error("[auth] token signing error:", (signErr as Error).message);
          return res.redirect(`${config.frontendUrl}/login?error=google_failed`);
        }
      }
    )(req, res, next);
  }
);

router.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.auth });
});

router.post("/logout", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;