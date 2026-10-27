import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";

const API_URL =
  process.env.STUDENT_API_URL ||
  "https://student-information-management-system-api.onrender.com/api/students";

function createServer() {
  const server = new McpServer({
    name: "student-information-mcp",
    version: "1.0.0"
  });

  server.registerTool(
    "list_students",
    {
      description: "Retrieve all student records from the Student Information Management System.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const response = await fetch(API_URL);

        if (!response.ok) {
          throw new Error(`Student API returned HTTP ${response.status}`);
        }

        const students = await response.json();

        return {
          content: [{
            type: "text",
            text: JSON.stringify(students, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Could not retrieve students: ${error.message}`
          }],
          isError: true
        };
      }
    }
  );

  server.registerTool(
    "search_student",
    {
      description: "Search student records by student ID, name, or email.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Student ID, name, or email to search for")
      })
    },
    async ({ query }) => {
      try {
        const response = await fetch(API_URL);

        if (!response.ok) {
          throw new Error(`Student API returned HTTP ${response.status}`);
        }

        const students = await response.json();
        const term = query.trim().toLowerCase();

        const matches = students.filter(student =>
          [student.studentId, student.name, student.email].some(
            value => String(value ?? "").toLowerCase().includes(term)
          )
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(matches, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Could not search students: ${error.message}`
          }],
          isError: true
        };
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

const handler = createMcpHandler(createServer);
const nodeHandler = toNodeHandler(handler);

app.all("/mcp", (req, res) => {
  void nodeHandler(req, res, req.body);
});

app.get("/", (req, res) => {
  res.json({ message: "Student Information MCP Server is running" });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Student MCP server listening on port ${PORT}`);
});
