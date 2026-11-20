require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { toFile } = require("openai");

const app = express();

const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY não configurada.");
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Configurações do Supabase ausentes.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// CORS
app.use(cors({
  origin: [
    FRONTEND_ORIGIN,
    "http://localhost:3000"
  ].filter(Boolean)
}));

// Receber imagens em Base64
app.use(express.json({ limit: "15mb" }));

// Limite de solicitações por IP
const requests = new Map();

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();

  const ip = req.ip;
  const now = Date.now();
  const record = requests.get(ip);

  if (!record || now - record.time > 60000) {
    requests.set(ip, { time: now, count: 1 });
    return next();
  }

  record.count++;

  if (record.count > 15) {
    return res.status(429).json({
      error: "Limite temporário de solicitações atingido."
    });
  }

  next();
});

// Autenticação Supabase
async function authenticate(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    const token = authorization.replace(/^Bearer\s+/i, "");

    if (!token || token === authorization) {
      return res.status(401).json({
        error: "Autenticação necessária."
      });
    }

    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      return res.status(401).json({
        error: "Sessão inválida ou expirada."
      });
    }

    req.user = await response.json();
    next();

  } catch (error) {
    console.error("Erro de autenticação:", error.message);

    return res.status(500).json({
      error: "Não foi possível verificar a autenticação."
    });
  }
}

// Verificar funcionamento
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    application: "Studio Foto IA",
    version: "1.2.0"
  });
});

// Gerar prompt fotográfico
app.post("/api/generate-prompt", authenticate, async (req, res) => {
  try {
    const {
      idea,
      module,
      style,
      format
    } = req.body;

    if (
      typeof idea !== "string" ||
      !idea.trim() ||
      idea.length > 5000
    ) {
      return res.status(400).json({
        error: "Informe uma ideia válida, com até 5000 caracteres."
      });
    }
