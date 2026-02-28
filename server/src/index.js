import "./env.js"; 

import express from "express";
import cors from "cors";
import { auth } from "./lib/auth.js";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import prisma from "./lib/db.js";
import { google } from "@ai-sdk/google";
import { streamText } from "ai";

const app = express();
app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"], 
    credentials: true, 
  })
);

app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

// ─── Auth Middleware ───────────────────────────────────────────────────────────
async function requireSession(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }
  const token = authHeader.slice(7);
  const user = await prisma.user.findFirst({
    where: { sessions: { some: { token } } },
  });
  if (!user) return res.status(401).json({ error: "Invalid or expired token" });
  req.user = user;
  next();
}

// ─── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.send('OK'));

// ─── Me ───────────────────────────────────────────────────────────────────────
app.get('/api/me', requireSession, (req, res) => {
  const { id, name, email, image } = req.user;
  res.json({ id, name, email, image });
});

// ─── Conversations ─────────────────────────────────────────────────────────────

// POST /api/conversations  → create
app.post('/api/conversations', requireSession, async (req, res) => {
  const { mode = "chat", title } = req.body;
  const conversation = await prisma.conversation.create({
    data: { userId: req.user.id, mode, title: title || `New ${mode} conversation` },
  });
  res.json(conversation);
});

// GET /api/conversations/:id  → get with messages
app.get('/api/conversations/:id', requireSession, async (req, res) => {
  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) return res.status(404).json({ error: "Not found" });
  res.json(conversation);
});

// POST /api/conversations/:id/messages  → add message
app.post('/api/conversations/:id/messages', requireSession, async (req, res) => {
  const { role, content } = req.body;
  const message = await prisma.message.create({
    data: { conversationId: req.params.id, role, content: typeof content === "string" ? content : JSON.stringify(content) },
  });
  res.json(message);
});

// POST /api/conversations/:id/title  → update title
app.post('/api/conversations/:id/title', requireSession, async (req, res) => {
  const { title } = req.body;
  const updated = await prisma.conversation.update({
    where: { id: req.params.id },
    data: { title },
  });
  res.json(updated);
});

// POST /api/conversations/:id/chat  → stream AI reply
app.post('/api/conversations/:id/chat', requireSession, async (req, res) => {
  try {
    const { messages } = req.body; // [{role, content}]

    const model = google(process.env.LAPRAS_MODEL || "gemini-2.5-flash");
    const result = streamText({ model, messages });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    let fullResponse = "";
    for await (const chunk of result.textStream) {
      fullResponse += chunk;
      res.write(chunk);
    }
    res.end();

    // Persist the AI response
    await prisma.message.create({
      data: { conversationId: req.params.id, role: "assistant", content: fullResponse },
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Device redirect ───────────────────────────────────────────────────────────
app.get("/device", async (req, res) => {
  const { user_code } = req.query;
  res.redirect(`${process.env.CLIENT_URL || "http://localhost:3000"}/device?user_code=${user_code}`);
});

// ─── Old /api/me (session-based, kept for web client) ─────────────────────────
app.get('/api/session/me', async(req, res) => {
  const session = await auth.getSession({ headers: fromNodeHeaders(req.headers) });
  return res.json(session);
});

app.listen(process.env.PORT || 3005, () => {
  console.log(`Server is running on port https://localhost:${process.env.PORT || 3005}`);
});