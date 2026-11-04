// SPDX-License-Identifier: Apache-2.0
/**
 * @aphrody/auth — Sovereign Better Auth Session Architecture & Types for Bun OS.
 */

export type AuthRole = "owner" | "admin" | "developer" | "guest";

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: AuthRole;
  isOwner: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Account {
  id: string;
  userId: string;
  accountId: string;
  providerId: "credential" | "passkey" | "google" | "sovereign";
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  passwordHash?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: number;
  ipAddress?: string;
  userAgent?: string;
  activeAccountId: string;
  isOwnerVerified: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PasskeyCredential {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceType?: string;
  backedUp?: boolean;
  transports?: string[];
  createdAt: number;
  lastUsedAt?: number;
}

export interface VerificationToken {
  id: string;
  identifier: string;
  value: string;
  expiresAt: number;
  createdAt: number;
}

export interface MultiAccountPresence {
  activeAccount: User;
  accounts: User[];
  session: Session;
  isOwner: boolean;
  hasPasskey: boolean;
}

export interface OwnerClaims {
  sub: string;
  iss: "aphrody.com" | string;
  aud: "bunos-webos" | string;
  role: AuthRole;
  is_owner: boolean;
  iat: number;
  exp: number;
}

export type AuthLanguage = "en" | "fr";

export interface PasskeyRegistrationOptions {
  challenge: string;
  rp: {
    name: string;
    id: string;
  };
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  pubKeyCredParams: Array<{
    type: "public-key";
    alg: number;
  }>;
  timeout: number;
  attestation: "none" | "direct" | "indirect";
  authenticatorSelection: {
    authenticatorAttachment?: "platform" | "cross-platform";
    residentKey: "required" | "preferred" | "discouraged";
    userVerification: "required" | "preferred" | "discouraged";
  };
}

export interface PasskeyAuthenticationOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: "required" | "preferred" | "discouraged";
  allowCredentials?: Array<{
    id: string;
    type: "public-key";
    transports?: string[];
  }>;
}
