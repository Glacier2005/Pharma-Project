import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? undefined : "change_me_in_production");
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is missing in production");
}
if (JWT_SECRET === "change_me_in_production") {
  console.warn("WARNING: Using fallback JWT_SECRET in development");
}
const JWT_EXPIRES_IN = "7d";

export interface JwtPayload {
  sub: string;      // user id
  role: string;     // UserRole
  pharmacyId?: string;
  iat?: number;
  exp?: number;
}

export function signToken(payload: Omit<JwtPayload, "iat" | "exp">): string {
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET as string) as JwtPayload;
}
