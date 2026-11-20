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
app.use(express.json({ limit: "40mb" }));

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
    version: "1.3.0"
  });
});
// Gerar instruções de edição a partir de uma ideia
app.post("/api/generate-prompt", authenticate, async (req, res) => {
  try {
    const { idea, intensity } = req.body;

    if (
      typeof idea !== "string" ||
      !idea.trim() ||
      idea.length > 3000
    ) {
      return res.status(400).json({
        error: "Descreva o que deseja criar."
      });
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Você é um especialista em fotografia e edição de imagens. Transforme a ideia do usuário em instruções claras e detalhadas para uma edição fotográfica realista. Preserve a identidade da pessoa quando solicitado. Responda somente com o prompt final."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Intensidade escolhida: ${intensity || "professional"}.\nIdeia: ${idea}`
            }
          ]
        }
      ]
    });

    res.json({
      prompt: response.output_text
    });

  } catch (error) {
    console.error("Erro ao gerar prompt:", error);

    res.status(500).json({
      error: "Não foi possível gerar as instruções."
    });
  }
});


// Analisar fotografia enviada
app.post("/api/analyze-image", authenticate, async (req, res) => {
  try {
    const { image } = req.body;

    if (
      typeof image !== "string" ||
      !/^data:image\/(jpeg|png|webp);base64,/i.test(image)
    ) {
      return res.status(400).json({
        error: "Envie uma imagem JPG, PNG ou WEBP válida."
      });
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Analise esta fotografia. Descreva objetivamente a pessoa, a roupa, a pose, o ambiente, a iluminação, o enquadramento e os elementos visuais. Não tente identificar a pessoa. Responda em português."
            },
            {
              type: "input_image",
              image_url: image
            }
          ]
        }
      ]
    });

    res.json({
      analysis: response.output_text
    });

  } catch (error) {
    console.error("Erro ao analisar imagem:", error);

    res.status(500).json({
      error: "Não foi possível analisar a fotografia."
    });
  }
});
