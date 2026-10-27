const domain = process.env.AUTH0_DOMAIN;
if (!domain) {
  throw new Error("AUTH0_DOMAIN must be configured.");
}

const issuer = `https://${domain}/`;

export const oauthMetadata = {
  issuer,
  authorization_endpoint: `${issuer}authorize`,
  token_endpoint: `${issuer}oauth/token`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  token_endpoint_auth_methods_supported: [
    "client_secret_basic",
    "client_secret_post"
  ],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: ["read:students", "write:students"]
};
