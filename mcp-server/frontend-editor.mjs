
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const OWNER = "sasanesanika336-art";
const REPO = "student-information-management-system";
const BASE_BRANCH = "main";

const allowedPaths = [
  "frontend/src/App.jsx",
  "frontend/src/App.css",
  "frontend/src/index.css"
];

function result(message, isError = false) {
  return {
    content: [{ type: "text", text: message }],
    ...(isError ? { isError: true } : {})
  };
}

async function githubApi(endpoint, options = {}) {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("GitHub token is not configured on the server.");
  }

  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  const body = await response.text();
  let data;

  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new Error("GitHub returned an unexpected response.");
  }

  if (!response.ok) {
    const detail =
      typeof data.message === "string" ? ` ${data.message}` : "";

    throw new Error(
      `GitHub request failed with HTTP ${response.status}.${detail}`
    );
  }

  return data;
}

const repoApi = `/repos/${OWNER}/${REPO}`;

const encodePath = (path) =>
  path.split("/").map(encodeURIComponent).join("/");

const contentsEndpoint = (path, ref = BASE_BRANCH) =>
  `${repoApi}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;

function validatePath(path) {
  if (!allowedPaths.includes(path)) {
    throw new Error(
      "This file is not on the approved frontend file list."
    );
  }
}

export function registerFrontendEditorTools(server) {
  server.registerTool(
    "read_frontend_file",
    {
      description:
        "Read the latest contents and SHA of an approved frontend file from GitHub main. Read the file before editing it.",
      inputSchema: {
        path: z
          .enum(allowedPaths)
          .describe("Approved frontend file path")
      }
    },
    async ({ path }) => {
      try {
        validatePath(path);

        const file = await githubApi(contentsEndpoint(path));

        if (!file.content || !file.sha) {
          throw new Error("GitHub did not return a readable file.");
        }

        return result(
          JSON.stringify(
            {
              path,
              branch: BASE_BRANCH,
              sha: file.sha,
              content: Buffer.from(file.content, "base64").toString("utf8")
            },
            null,
            2
          )
        );
      } catch (error) {
        return result(
          error.message || "Unable to read the frontend file.",
          true
        );
      }
    }
  );

  server.registerTool(
    "write_frontend_file",
    {
      description:
        "Update an approved frontend file directly on GitHub main. First call read_frontend_file and use its exact SHA as expectedSha. Supply the complete updated file content. Only approved frontend files can be changed. A successful write commits directly to main and can trigger Netlify deployment.",
      inputSchema: {
        path: z
          .enum(allowedPaths)
          .describe("Approved frontend file path"),
        content: z
          .string()
          .max(200000)
          .describe("Complete updated UTF-8 file contents"),
        expectedSha: z
          .string()
          .min(1)
          .describe("Exact SHA returned by read_frontend_file"),
        summary: z
          .string()
          .trim()
          .min(5)
          .max(100)
          .describe("Short description of the frontend change")
      }
    },
    async ({ path, content, expectedSha, summary }) => {
      try {
        validatePath(path);

        const latestFile = await githubApi(contentsEndpoint(path));

        if (latestFile.sha !== expectedSha) {
          throw new Error(
            `Write stopped: ${path} changed on GitHub after it was read. Read the latest version and reapply the requested change.`
          );
        }

        const commit = await githubApi(
          `${repoApi}/contents/${encodePath(path)}`,
          {
            method: "PUT",
            body: JSON.stringify({
              message: `Update frontend: ${summary}`,
              content: Buffer.from(content, "utf8").toString("base64"),
              sha: latestFile.sha,
              branch: BASE_BRANCH
            })
          }
        );

        return result(
          JSON.stringify(
            {
              success: true,
              path,
              branch: BASE_BRANCH,
              commitSha: commit.commit?.sha,
              commitUrl: commit.commit?.html_url,
              productionChanged: true,
              message:
                "The file was committed directly to GitHub main. Netlify deployment depends on the repository's existing deployment configuration."
            },
            null,
            2
          )
        );
      } catch (error) {
        return result(
          error.message || "Unable to write the frontend file.",
          true
        );
      }
    }
  );
}

function createFrontendEditorServer() {
  const server = new McpServer({
    name: "student-frontend-editor",
    version: "3.0.0"
  });

  registerFrontendEditorTools(server);
  return server;
}

export const frontendEditorHandler = createMcpHandler(
  createFrontendEditorServer
);
