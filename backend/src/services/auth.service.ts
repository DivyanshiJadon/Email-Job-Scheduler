import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { AppDataSource } from "../db/typeorm";
import { User } from "../db/entities/User";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface AppJwtPayload {
  sub: string;
  email: string;
  name: string;
  avatar?: string | null;
}

export function signToken(user: User): string {
  const payload: AppJwtPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatarUrl,
  };
  return jwt.sign(payload, config.auth.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string): AppJwtPayload | null {
  try {
    return jwt.verify(token, config.auth.jwtSecret) as AppJwtPayload;
  } catch {
    return null;
  }
}

export function googleOAuthConfigured(): boolean {
  return Boolean(config.auth.googleClientId && config.auth.googleClientSecret);
}

export function setupPassport(): void {
  const { googleClientId, googleClientSecret, googleRedirectUri } = config.auth;
  if (!googleClientId || !googleClientSecret) {
    console.warn("[auth] GOOGLE_CLIENT_ID/SECRET not set — Google OAuth disabled. Login page will show a setup hint.");
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: googleRedirectUri,
      },
      async (accessToken, refreshToken, profile: Profile, done) => {
        try {
          const repo = AppDataSource.getRepository(User);
          let user = await repo.findOne({ where: { googleId: profile.id } });
          if (!user) {
            user = await repo.findOne({ where: { email: profile.emails?.[0]?.value ?? "" } });
          }
          if (!user) {
            user = repo.create({
              googleId: profile.id,
              email: profile.emails?.[0]?.value ?? `${profile.id}@google.local`,
              name: profile.displayName ?? "Google User",
              avatarUrl: profile.photos?.[0]?.value ?? null,
            });
            user = await repo.save(user);
          } else {
            user.googleId = profile.id;
            user.name = profile.name?.givenName ?? profile.displayName ?? user.name;
            user.avatarUrl = profile.photos?.[0]?.value ?? user.avatarUrl;
            user = await repo.save(user);
          }
          return done(null, user);
        } catch (err) {
          return done(err as Error);
        }
      }
    )
  );
}