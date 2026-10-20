import {
  McpServer,
  createMcpHandler
} from "@modelcontextprotocol/server";
import {
  createMcpExpressApp,
  requireBearerAuth,
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";
import { verifier } from "./auth.mjs";
import { oauthMetadata } from "./oauth-metadata.mjs";

const API_URL =
  process.env.STUDENT_API_URL ||
  "https://student-information-management-system-api.onrender.com/api/students";

const resourceUrl = new URL(
  process.env.AUTH0_AUDIENCE ||
  "https://student-information-mcp.onrender.com"
);

const resourceMetadataUrl =
  getOAuthProtectedResourceMetadataUrl(resourceUrl);

const studentFields = {
  studentId: z.string().trim().min(1).describe("Unique student ID"),
  name: z.string().trim().min(1).describe("Student name"),
  email: z.string().trim().email().describe("Student email"),
  department: z.string().trim().min(1).describe("Department"),
  semester: z.number().int().min(1).max(8).describe("Semester from 1 to 8"),
  contact: z.string().trim().regex(/^\d{10}$/).describe("10-digit contact number")
};

function result(message, isError = false) {
  return {
    content: [{ type: "text", text: message }],
    ...(isError ? { isError: true } : {})
  };
}

function hasScope(ctx, requiredScope) {
  const scopes = ctx?.http?.authInfo?.scopes ?? [];

  console.log("[MCP Auth] Required permission:", requiredScope);
  console.log("[MCP Auth] Received permissions:", scopes);

  return scopes.includes(requiredScope);
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      `Student API returned HTTP ${response.status}: ${data.message || "Request failed"}`
    );
  }

  return data;
}

function createServer() {
  const server = new McpServer({
    name: "student-information-mcp",
    version: "1.2.0"
  });

  server.registerTool(
    "list_students",
    {
      description: "Retrieve all student records. Requires read:students permission.",
      inputSchema: z.object({})
    },
    async (_args, ctx) => {
      if (!hasScope(ctx, "read:students")) {
        return result("Forbidden: read:students permission is required.", true);
      }

      try {
        const students = await apiRequest(API_URL);
        return result(JSON.stringify(students, null, 2));
      } catch (error) {
        return result(`Could not retrieve students: ${error.message}`, true);
      }
    }
  );

  server.registerTool(
    "search_student",
    {
      description: "Search students by student ID, name, or email. Requires read:students permission.",
      inputSchema: z.object({
        query: z.string().trim().min(1).describe("Student ID, name, or email")
      })
    },
    async ({ query }, ctx) => {
      if (!hasScope(ctx, "read:students")) {
        return result("Forbidden: read:students permission is required.", true);
      }

      try {
        const students = await apiRequest(API_URL);
        const term = query.toLowerCase();

        const matches = students.filter(student =>
          [student.studentId, student.name, student.email].some(value =>
            String(value ?? "").toLowerCase().includes(term)
          )
        );

        return result(JSON.stringify(matches, null, 2));
      } catch (error) {
        return result(`Could not search students: ${error.message}`, true);
      }
    }
  );

  server.registerTool(
    "insert_student",
    {
      description: "Insert a student record. Requires write:students permission and confirm=true.",
      inputSchema: z.object({
        ...studentFields,
        confirm: z.boolean().describe("Must be true to authorize insertion")
      })
    },
    async ({ confirm, ...student }, ctx) => {
      if (!hasScope(ctx, "write:students")) {
        return result("Forbidden: write:students permission is required.", true);
      }

      if (!confirm) {
        return result("Insertion cancelled. Set confirm=true only when authorized to add this student.", true);
      }

      try {
        const created = await apiRequest(API_URL, {
          method: "POST",
          body: JSON.stringify(student)
        });
        return result(JSON.stringify(created, null, 2));
      } catch (error) {
        return result(`Could not insert student: ${error.message}`, true);
      }
    }
  );

  server.registerTool(
    "update_student",
    {
      description: "Update a student by ID. Requires write:students permission and confirm=true.",
      inputSchema: z.object({
        studentId: z.string().trim().min(1).describe("Existing student ID"),
        name: studentFields.name,
        email: studentFields.email,
        department: studentFields.department,
        semester: studentFields.semester,
        contact: studentFields.contact,
        confirm: z.boolean().describe("Must be true to authorize the update")
      })
    },
    async ({ studentId, confirm, ...updates }, ctx) => {
      if (!hasScope(ctx, "write:students")) {
        return result("Forbidden: write:students permission is required.", true);
      }

      if (!confirm) {
        return result("Update cancelled. Set confirm=true only after verifying the student and changes.", true);
      }

      try {
        const updated = await apiRequest(
          `${API_URL}/${encodeURIComponent(studentId)}`,
          {
            method: "PUT",
            body: JSON.stringify(updates)
          }
        );
        return result(JSON.stringify(updated, null, 2));
      } catch (error) {
        return result(`Could not update student: ${error.message}`, true);
      }
    }
  );

  server.registerTool(
    "delete_student",
    {
      description: "Permanently delete a student by ID. Requires write:students permission and confirm=true.",
      inputSchema: z.object({
        studentId: z.string().trim().min(1).describe("Exact student ID to delete"),
        confirm: z.boolean().describe("Must be true to authorize permanent deletion")
      })
    },
    async ({ studentId, confirm }, ctx) => {
      if (!hasScope(ctx, "write:students")) {
        return result("Forbidden: write:students permission is required.", true);
      }

      if (!confirm) {
        return result("Deletion cancelled. Set confirm=true only after verifying the exact student ID and obtaining authorization.", true);
      }

      try {
        const deleted = await apiRequest(
          `${API_URL}/${encodeURIComponent(studentId)}`,
          { method: "DELETE" }
        );
        return result(JSON.stringify(deleted, null, 2));
      } catch (error) {
        return result(`Could not delete student: ${error.message}`, true);
      }
    }
  );

  return server;
}

const app = createMcpExpressApp({
  host: "0.0.0.0",
  allowedHosts: [
    "localhost",
    "127.0.0.1",
    ...(process.env.RENDER_EXTERNAL_HOSTNAME
      ? [process.env.RENDER_EXTERNAL_HOSTNAME]
      : [])
  ]
});

app.use(
  mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: resourceUrl,
    scopesSupported: ["read:students", "write:students"]
  })
);

const handler = createMcpHandler(createServer);
const nodeHandler = toNodeHandler(handler);


const requireAuthorizationHeader = (req, res, next) => {
  const authorization = req.get("authorization");

  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    res.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${resourceMetadataUrl}"`
    );

    return res.status(401).json({
      error: "invalid_token",
      error_description: "A valid Bearer Authorization header is required."
    });
  }

  next();
};

app.all(
  "/mcp",
  requireAuthorizationHeader,
    requireBearerAuth({
    verifier,
    expectedResource: resourceUrl,
    resourceMetadataUrl,
    requiredScopes: ["read:students"]
  }),
  (req, res) => {
    void nodeHandler(req, res, req.body);
  }
);


app.get("/", (_req, res) => {
  res.json({ message: "Student Information MCP Server is running" });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Student MCP server listening on port ${PORT}`);
});
