import { Router, Request, Response, NextFunction } from "express";
import passport from "passport";
import { config } from "../config";
import { demoUser, signToken } from "../services/auth.service";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

const googleScopes: Array<"profile" | "email"> = ["profile", "email"];

router.get("/google", (req, res, next) => {
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
      { session: false, failureRedirect: `${config.frontendUrl}/login?error=google_denied` },
      (err: Error | null, user?: Express.User) => {
        if (err) return next(err);
        if (!user) {
          return res.redirect(`${config.frontendUrl}/login?error=google_denied`);
        }
        const token = signToken(user as never);
        res.redirect(`${config.frontendUrl}/auth?token=${encodeURIComponent(token)}`);
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

router.post("/demo", async (_req: Request, res: Response) => {
  if (!config.auth.demoMode) {
    return res.status(403).json({ error: "Demo mode is disabled" });
  }
  const user = await demoUser();
  res.json({ user, token: signToken(user) });
});

export default router;