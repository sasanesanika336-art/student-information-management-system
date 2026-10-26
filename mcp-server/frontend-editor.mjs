import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const OWNER = "sasanesanika336-art";
const REPO = "student-information-management-system";
const BRANCH = "main";

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

async function githubRequest(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GitHub token is not configured on the server.");

  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`,
    {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    }
  );

  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new Error("GitHub returned an unexpected response.");
  }

  if (!response.ok) {
    throw new Error(`GitHub request failed with HTTP ${response.status}.`);
  }
  return data;
}

function validatePath(path) {
  if (!allowedPaths.includes(path)) {
    throw new Error("This file is not on the approved frontend file list.");
  }
}

function createFrontendEditorServer() {
  const server = new McpServer({
    name: "student-frontend-editor",
    version: "1.0.0"
  });

  server.registerTool(
    "read_frontend_file",
    {
      description: "Read the current contents of an approved frontend file from the main GitHub branch.",
      inputSchema: {
        path: z.enum(allowedPaths).describe("Approved frontend file path")
      }
    },
    async ({ path }) => {
      try {
        validatePath(path);
        const file = await githubRequest(path);
        if (!file.content || !file.sha) {
          throw new Error("GitHub did not return a readable file.");
        }
        const content = Buffer.from(file.content, "base64").toString("utf8");
        return result(JSON.stringify({
          path,
          branch: BRANCH,
          sha: file.sha,
          content
        }));
      } catch (error) {
        return result(error.message || "Unable to read the frontend file.", true);
      }
    }
  );

  server.registerTool(
    "commit_frontend_file",
    {
      description: "Commit a complete updated version of an approved frontend file to main. First read the latest file, make the requested change, and obtain the user's explicit approval before calling this tool with confirm=true. Never overwrite unrelated changes.",
      inputSchema: {
        path: z.enum(allowedPaths).describe("Approved frontend file path"),
        content: z.string().max(200000).describe("Complete updated UTF-8 file contents"),
        expectedSha: z.string().min(1).describe("SHA returned by read_frontend_file for the version being edited"),
        message: z.string().trim().min(5).max(120).describe("Concise Git commit message"),
        confirm: z.boolean().describe("Must be true only after the user explicitly approves this commit")
      }
    },
    async ({ path, content, expectedSha, message, confirm }) => {
      try {
        validatePath(path);

        if (!confirm) {
          return result("Commit cancelled. Ask the user for approval before retrying.");
        }

        const latest = await githubRequest(path);
        if (latest.sha !== expectedSha) {
          return result(
            "Commit stopped: this file changed on GitHub after it was read. Read the latest version and reapply the requested change before asking for approval again.",
            true
          );
        }

        const updated = await githubRequest(path, {
          method: "PUT",
          body: JSON.stringify({
            message,
            content: Buffer.from(content, "utf8").toString("base64"),
            sha: latest.sha,
            branch: BRANCH
          })
        });

        return result(JSON.stringify({
          success: true,
          path,
          branch: BRANCH,
          commit: updated.commit?.sha,
          message: "GitHub accepted the commit. Netlify deployment may take a few minutes; check the Netlify deploy status."
        }));
      } catch (error) {
        return result(error.message || "The frontend commit failed.", true);
      }
    }
  );

  return server;
}

export const frontendEditorHandler = createMcpHandler(
  createFrontendEditorServer
);
