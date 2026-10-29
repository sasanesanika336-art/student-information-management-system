
import {
  McpServer,
  createMcpHandler
} from "@modelcontextprotocol/server";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { timingSafeEqual } from "node:crypto";
import * as z from "zod/v4";

import {
  registerFrontendEditorTools,
  frontendEditorHandler
} from "./frontend-editor.mjs";

const API_URL =
  process.env.STUDENT_API_URL ||
  "https://student-information-management-system-api.onrender.com/api/students";

// Shared secret used to authenticate incoming Claude MCP requests.
// Configure MCP_CONNECTOR_SECRET in both local .env and Render.
function requireConnectorSecret(req, res, next) {
  const expected = process.env.MCP_CONNECTOR_SECRET;

  if (!expected) {
    return res.status(503).json({
      error: "MCP connector secret is not configured."
    });
  }

  const supplied = req.get("x-mcp-connector-secret") || "";
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

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

async function apiRequest(url, options = {}) {
  const secret = process.env.MCP_API_SECRET;

  if (!secret) {
    throw new Error("MCP_API_SECRET is not configured on the MCP server.");
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      "x-mcp-secret": secret
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
      `Student API returned HTTP ${response.status}: ${
        data.message || "Request failed"
      }`
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
      description: "Retrieve all student records.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        return result(JSON.stringify(await apiRequest(API_URL), null, 2));
      } catch (error) {
        return result(`Could not retrieve students: ${error.message}`, true);
      }
    }
  );

  server.registerTool(
    "search_student",
    {
      description: "Search students by student ID, name, or email.",
      inputSchema: z.object({
        query: z.string().trim().min(1).describe("Student ID, name, or email")
      })
    },
    async ({ query }) => {
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
      description: "Insert a dummy student record. Requires confirm=true.",
      inputSchema: z.object({
        ...studentFields,
        confirm: z.boolean().describe("Must be true to authorize insertion")
      })
    },
    async ({ confirm, ...student }) => {
      if (!confirm) {
        return result("Insertion cancelled. Set confirm=true to proceed.", true);
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
      description: "Update a student record. Requires confirm=true.",
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
    async ({ studentId, confirm, ...updates }) => {
      if (!confirm) {
        return result("Update cancelled. Set confirm=true to proceed.", true);
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
      description: "Delete a student record. Requires confirm=true.",
      inputSchema: z.object({
        studentId: z.string().trim().min(1).describe("Exact student ID to delete"),
        confirm: z.boolean().describe("Must be true to authorize deletion")
      })
    },
    async ({ studentId, confirm }) => {
      if (!confirm) {
        return result("Deletion cancelled. Set confirm=true to proceed.", true);
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

  // Register both frontend editor tools.
  registerFrontendEditorTools(server);

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

const handler = createMcpHandler(createServer);
const nodeHandler = toNodeHandler(handler);

app.get("/", (_req, res) => {
  res.json({
    message: "Student Information MCP Server is running"
  });
});

// Protect all student MCP tools with the shared secret.
app.all("/mcp", (req, res) => {
  void nodeHandler(req, res, req.body);
});

// Protect frontend file reading and GitHub commits with the same secret.
const frontendNodeHandler = toNodeHandler(frontendEditorHandler);

app.all("/frontend-mcp", (req, res) => {
  void frontendNodeHandler(req, res, req.body);
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Student MCP server listening on port ${PORT}`);
});
