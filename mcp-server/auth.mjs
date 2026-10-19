import { createRemoteJWKSet, jwtVerify } from "jose";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

const domain = process.env.AUTH0_DOMAIN;
const audience = process.env.AUTH0_AUDIENCE;

if (!domain || !audience) {
  throw new Error("AUTH0_DOMAIN and AUTH0_AUDIENCE must be configured.");
}

const issuer = `https://${domain}/`;
const jwks = createRemoteJWKSet(
  new URL(`${issuer}.well-known/jwks.json`)
);

export const verifier = {
  async verifyAccessToken(token) {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
        algorithms: ["RS256"]
      });

      if (
        typeof payload.sub !== "string" ||
        typeof payload.exp !== "number"
      ) {
        throw new Error("Required token claims are missing.");
      }

      const scopeClaim =
        typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];

      const permissionClaim =
        Array.isArray(payload.permissions) ? payload.permissions : [];

      const scopes = [
        ...new Set([...scopeClaim, ...permissionClaim])
      ].filter(scope => typeof scope === "string" && scope.length > 0);

      return {
        token,
        clientId: payload.sub,
        scopes,
        expiresAt: payload.exp,
        resource: new URL(audience)
      };
    } catch {
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        "Invalid or expired Auth0 access token."
      );
    }
  }
};
