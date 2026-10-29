import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const OWNER = "sasanesanika336-art";
const REPO = "student-information-management-system";
const BASE_BRANCH = "main";
const DRAFT_PREFIX = "frontend-draft-";

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
  if (!token) throw new Error("GitHub token is not configured on the server.");

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
    const detail = typeof data.message === "string" ? ` ${data.message}` : "";
    throw new Error(`GitHub request failed with HTTP ${response.status}.${detail}`);
  }
  return data;
}

const repoApi = `/repos/${OWNER}/${REPO}`;
const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
const contentsEndpoint = (path, ref = BASE_BRANCH) =>
  `${repoApi}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;

function validatePath(path) {
  if (!allowedPaths.includes(path)) {
    throw new Error("This file is not on the approved frontend file list.");
  }
}

async function getPullRequest(draftNumber) {
  if (!Number.isInteger(draftNumber) || draftNumber < 1) {
    throw new Error("Provide the valid pull request number returned by create_frontend_draft.");
  }
  const pr = await githubApi(`${repoApi}/pulls/${draftNumber}`);
  if (
    pr.base?.ref !== BASE_BRANCH ||
    !String(pr.head?.ref || "").startsWith(DRAFT_PREFIX) ||
    pr.head?.repo?.full_name?.toLowerCase() !== `${OWNER}/${REPO}`.toLowerCase() ||
    !String(pr.title || "").startsWith("[Frontend Draft]")
  ) {
    throw new Error("This pull request was not created by the frontend draft workflow. No action was taken.");
  }
  return pr;
}

async function validatePullRequestFiles(draftNumber) {
  const files = await githubApi(`${repoApi}/pulls/${draftNumber}/files?per_page=100`);

  if (!Array.isArray(files) || files.length < 1 || files.length > allowedPaths.length) {
    throw new Error("Unable to verify the draft file list safely. Nothing was merged.");
  }

  const paths = files.map(file => file.filename);
  if (new Set(paths).size !== paths.length || paths.some(path => !allowedPaths.includes(path))) {
    throw new Error("Draft contains duplicate or unapproved files. Nothing was merged.");
  }
}
function extractPreviewUrl(text) {
  if (typeof text !== "string") return null;
  const urls = text.match(/https:\/\/[^\s<>"'()]+/g) || [];
  for (const raw of urls) {
    const candidate = raw.replace(/[.,;]+$/, "");
    try {
      const url = new URL(candidate);
      if (
        url.hostname.endsWith(".netlify.app") ||
        (url.hostname.endsWith(".netlify.com") && /deploy-preview|preview/i.test(url.href))
      ) return url.href;
    } catch {
      // Ignore non-URL text fragments.
    }
  }
  return null;
}

export function registerFrontendEditorTools(server) {
  server.registerTool(
    "read_frontend_file",
    {
      description: "Read the current contents of an approved frontend file from GitHub main before preparing a draft. Reading is safe and makes no changes.",
      inputSchema: {
        path: z.enum(allowedPaths).describe("Approved frontend file path")
      }
    },
    async ({ path }) => {
      try {
        validatePath(path);
        const file = await githubApi(contentsEndpoint(path));
        if (!file.content || !file.sha) throw new Error("GitHub did not return a readable file.");
        return result(JSON.stringify({
          path,
          branch: BASE_BRANCH,
          sha: file.sha,
          content: Buffer.from(file.content, "base64").toString("utf8")
        }));
      } catch (error) {
        return result(error.message || "Unable to read the frontend file.", true);
      }
    }
  );

  server.registerTool(
    "create_frontend_draft",
    {
      description: "Create a non-production frontend draft by committing only approved frontend file changes to a new frontend-draft-* branch and opening a pull request to main. This does not merge or deploy production. Use read_frontend_file first and pass the exact SHA for every changed file. Tell the user to review the Netlify Deploy Preview before asking for confirmation.",
      inputSchema: {
        summary: z.string().trim().min(5).max(100).describe("Short description of the requested frontend change"),
        changes: z.array(z.object({
          path: z.enum(allowedPaths).describe("Approved frontend file path"),
          content: z.string().max(200000).describe("Complete updated UTF-8 file contents"),
          expectedSha: z.string().min(1).describe("SHA returned by read_frontend_file for this exact file version")
        })).min(1).max(3).describe("Only the approved frontend files that need changes")
      }
    },
    async ({ summary, changes }) => {
      let branch;
      try {
        const paths = changes.map((change) => change.path);
        if (new Set(paths).size !== paths.length) throw new Error("Include each file path only once.");
        for (const change of changes) validatePath(change.path);

        // Optimistic concurrency check: never draft over a file changed since Claude read it.
        for (const change of changes) {
          const latestFile = await githubApi(contentsEndpoint(change.path));
          if (latestFile.sha !== change.expectedSha) {
            throw new Error(`Draft stopped: ${change.path} changed on GitHub after it was read. Read the latest version and reapply the requested change.`);
          }
        }

        const mainRef = await githubApi(`${repoApi}/git/ref/heads/${BASE_BRANCH}`);
        const parentSha = mainRef.object?.sha;
        if (!parentSha) throw new Error("Could not identify the current main commit.");
        const parentCommit = await githubApi(`${repoApi}/git/commits/${parentSha}`);
        const treeEntries = [];

        for (const change of changes) {
          const blob = await githubApi(`${repoApi}/git/blobs`, {
            method: "POST",
            body: JSON.stringify({
              content: Buffer.from(change.content, "utf8").toString("base64"),
              encoding: "base64"
            })
          });
          treeEntries.push({
            path: change.path,
            mode: "100644",
            type: "blob",
            sha: blob.sha
          });
        }

        const tree = await githubApi(`${repoApi}/git/trees`, {
          method: "POST",
          body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: treeEntries })
        });
        const commit = await githubApi(`${repoApi}/git/commits`, {
          method: "POST",
          body: JSON.stringify({
            message: `Draft frontend: ${summary}`.slice(0, 120),
            tree: tree.sha,
            parents: [parentSha]
          })
        });

        branch = `${DRAFT_PREFIX}${Date.now()}`;
        await githubApi(`${repoApi}/git/refs`, {
          method: "POST",
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha })
        });

        const pr = await githubApi(`${repoApi}/pulls`, {
          method: "POST",
          body: JSON.stringify({
            title: `[Frontend Draft] ${summary}`.slice(0, 240),
            head: branch,
            base: BASE_BRANCH,
            body: [
              "## Frontend draft preview",
              "",
              "This pull request was created by the Student Information Management System frontend editor.",
              "- Only approved frontend files are included.",
              "- This is a draft for review; it has **not** been merged into `main`.",
              "- Production deployment must not occur until the user explicitly confirms.",
              "- Review the Netlify Deploy Preview associated with this pull request before confirming."
            ].join("\n")
          })
        });

        return result(JSON.stringify({
          success: true,
          draftNumber: pr.number,
          branch,
          pullRequestUrl: pr.html_url,
          changedFiles: paths,
          productionChanged: false,
          message: "Draft created. It has not been merged into main. Wait for Netlify's Deploy Preview to finish, then call get_frontend_draft_status with this draftNumber to retrieve the preview URL. Do not merge until the user explicitly confirms."
        }, null, 2));
      } catch (error) {
        if (branch) {
          try { await githubApi(`${repoApi}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "DELETE" }); } catch { /* best-effort cleanup */ }
        }
        return result(error.message || "Unable to create frontend draft.", true);
      }
    }
  );

  server.registerTool(
    "get_frontend_draft_status",
    {
      description: "Check a frontend draft pull request and find its Netlify Deploy Preview URL if Netlify has reported one. Does not change files or merge anything.",
      inputSchema: {
        draftNumber: z.number().int().positive().describe("Pull request number returned by create_frontend_draft")
      }
    },
    async ({ draftNumber }) => {
      try {
        const pr = await getPullRequest(draftNumber);
        const headSha = pr.head?.sha;
        const [statusesResult, checksResult, commentsResult] = await Promise.allSettled([
          githubApi(`${repoApi}/commits/${headSha}/statuses?per_page=100`),
          githubApi(`${repoApi}/commits/${headSha}/check-runs?per_page=100`),
          githubApi(`${repoApi}/issues/${draftNumber}/comments?per_page=100`)
        ]);

        const statusItems = statusesResult.status === "fulfilled" ? statusesResult.value : [];
        const checks = checksResult.status === "fulfilled" ? (checksResult.value.check_runs || []) : [];
        const comments = commentsResult.status === "fulfilled" ? commentsResult.value : [];
        let previewUrl = null;
        for (const item of statusItems) {
          previewUrl ||= extractPreviewUrl(item.target_url) || extractPreviewUrl(item.description);
        }
        for (const item of checks) {
          previewUrl ||= extractPreviewUrl(item.details_url) || extractPreviewUrl(item.output?.summary) || extractPreviewUrl(item.output?.text);
        }
        for (const item of comments) previewUrl ||= extractPreviewUrl(item.body);

        const checksSummary = [
          ...statusItems.map((item) => ({ name: item.context, state: item.state, description: item.description })),
          ...checks.map((item) => ({ name: item.name, state: item.conclusion || item.status, details: item.details_url }))
        ];

        return result(JSON.stringify({
          draftNumber,
          state: pr.state,
          merged: pr.merged,
          pullRequestUrl: pr.html_url,
          previewUrl,
          checks: checksSummary,
          message: previewUrl
            ? "Preview URL found. Review it carefully; production has not changed."
            : "No direct Netlify preview URL was found yet. Check the pull request's Deploy Preview status or comments and retry shortly. Production has not changed."
        }, null, 2));
      } catch (error) {
        return result(error.message || "Unable to check frontend draft status.", true);
      }
    }
  );

  server.registerTool(
    "confirm_frontend_draft",
    {
      description: "Merge a frontend draft pull request into main and thereby allow the production deployment. Call only after the user explicitly says to confirm/approve this exact draft after reviewing its preview. The confirm argument must be true.",
      inputSchema: {
        draftNumber: z.number().int().positive().describe("Pull request number returned by create_frontend_draft"),
        confirm: z.boolean().describe("Must be true only after the user explicitly approves this exact draft")
      }
    },
    async ({ draftNumber, confirm }) => {
      try {
        if (!confirm) return result("Confirmation missing. Nothing was merged.");
        const pr = await getPullRequest(draftNumber);
        await validatePullRequestFiles(draftNumber);
        if (pr.state !== "open" || pr.merged) throw new Error("This draft is not an open, unmerged pull request.");

        const merged = await githubApi(`${repoApi}/pulls/${draftNumber}/merge`, {
          method: "PUT",
          body: JSON.stringify({ merge_method: "squash" })
        });
        if (!merged.merged) throw new Error("GitHub did not confirm the merge. Production was not changed by this tool.");

        try { await githubApi(`${repoApi}/git/refs/heads/${encodeURIComponent(pr.head.ref)}`, { method: "DELETE" }); } catch { /* branch cleanup is best-effort after successful merge */ }
        return result(JSON.stringify({
          success: true,
          draftNumber,
          mergeCommit: merged.sha,
          productionChanged: true,
          message: "Draft merged into main. Netlify production deployment may take a few minutes; check Netlify deploy status."
        }, null, 2));
      } catch (error) {
        return result(error.message || "Unable to confirm frontend draft.", true);
      }
    }
  );

  server.registerTool(
    "discard_frontend_draft",
    {
      description: "Discard an unmerged frontend draft by closing its pull request and deleting its draft branch. Call only after the user explicitly says to discard this exact draft. This never changes main or production.",
      inputSchema: {
        draftNumber: z.number().int().positive().describe("Pull request number returned by create_frontend_draft"),
        confirm: z.boolean().describe("Must be true only after the user explicitly asks to discard this exact draft")
      }
    },
    async ({ draftNumber, confirm }) => {
      try {
        if (!confirm) return result("Discard confirmation missing. Nothing was changed.");
        const pr = await getPullRequest(draftNumber);
        if (pr.merged) throw new Error("This draft has already been merged and cannot be discarded as an unmerged draft.");
        if (pr.state === "closed") return result("This draft pull request is already closed. No production changes were made.");

        await githubApi(`${repoApi}/pulls/${draftNumber}`, {
          method: "PATCH",
          body: JSON.stringify({ state: "closed" })
        });
        let branchDeleted = true;
        try {
          await githubApi(`${repoApi}/git/refs/heads/${encodeURIComponent(pr.head.ref)}`, { method: "DELETE" });
        } catch {
          branchDeleted = false;
        }

        return result(JSON.stringify({
          success: true,
          draftNumber,
          branchDeleted,
          productionChanged: false,
          message: branchDeleted
            ? "Draft discarded. Its pull request is closed and the draft branch is deleted. main and production were not changed."
            : "Draft pull request closed, but GitHub did not delete the branch. main and production were not changed."
        }, null, 2));
      } catch (error) {
        return result(error.message || "Unable to discard frontend draft.", true);
      }
    }
  );
}

function createFrontendEditorServer() {
  const server = new McpServer({ name: "student-frontend-editor", version: "2.0.0" });
  registerFrontendEditorTools(server);
  return server;
}

export const frontendEditorHandler = createMcpHandler(createFrontendEditorServer);
