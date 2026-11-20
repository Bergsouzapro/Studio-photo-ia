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
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",

      instructions: `
Você é o diretor criativo do Studio Foto IA.

Sua especialidade é fotografia realista,
direção fotográfica e engenharia de prompts.

Crie prompts detalhados, modernos e profissionais.

PRIORIDADES:
- Aparência de fotografia verdadeira.
- Texturas naturais de pele.
- Iluminação fisicamente plausível.
- Cores naturais e equilibradas.
- Evitar aparência artificial de inteligência artificial.
- Evitar pele excessivamente lisa.
- Evitar nitidez exagerada.
- Preservar identidade e características físicas.

Nunca invente características pessoais não informadas.

Responda em português brasileiro.

Entregue:
1. Conceito fotográfico.
2. Direção de cenário e composição.
3. Iluminação.
4. Enquadramento e câmera.
5. Prompt final completo.
6. Recomendações de uso.

Não gere imagens. Produza somente texto.
      `,

      input: `
Módulo: ${module || "fotografia"}
Estilo: ${style || "a definir"}
Formato: ${format || "a definir"}

IDEIA DO USUÁRIO:
${idea}
      `
    });

    return res.json({
      success: true,
      prompt: response.output_text
    });

  } catch (error) {
    console.error("Erro ao gerar prompt:", error.message);

    return res.status(500).json({
      error: "Não foi possível preparar o prompt."
    });
  }
});

// Analisar fotografia
app.post("/api/analyze-image", authenticate, async (req, res) => {
  try {
    const {
      image,
      module,
      objective
    } = req.body;

    if (
      typeof image !== "string" ||
      !/^data:image\/(jpeg|png|webp);base64,/i.test(image)
    ) {
      return res.status(400).json({
        error: "Fotografia inválida. Utilize JPG, PNG ou WEBP."
      });
    }

    if (image.length > 12 * 1024 * 1024) {
      return res.status(413).json({
        error: "Fotografia muito grande. Reduza o tamanho."
      });
    }

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",

      instructions: `
Você é um diretor de fotografia especializado
em análise visual e fotografia realista.

Analise a fotografia enviada.

Observe:
- Cenário e ambiente.
- Pose e postura.
- Vestuário.
- Iluminação.
- Enquadramento.
- Composição.
- Qualidade técnica.
- Oportunidades de melhoria.

Se for uma fotografia pessoal, priorize
a preservação da identidade e da aparência real.

Não afirme características que não possam
ser observadas na imagem.

Apresente sugestões práticas e específicas.

Prepare um prompt profissional para o objetivo
solicitado.

Não gere imagens. Responda somente com texto.
      `,

      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
Módulo: ${module || "análise de referência"}

Objetivo: ${objective || "Analisar e sugerir melhorias."}

Analise a fotografia e apresente três possibilidades
de melhoria, priorizando a naturalidade.
Prepare também o melhor prompt recomendado.
            `
          },
          {
            type: "input_image",
            image_url: image,
            detail: "high"
          }
        ]
      }]
    });

    return res.json({
      success: true,
      analysis: response.output_text
    });

  } catch (error) {
    console.error("Erro na análise:", error.message);

    return res.status(500).json({
      error: "Não foi possível analisar a fotografia."
    });
  }
});
// EDITAR FOTOGRAFIA COM IA
app.post("/api/edit-image", authenticate, async (req, res) => {
  try {
    const { image, prompt, intensity, mask } = req.body;

    if (
      typeof image !== "string" ||
      !/^data:image\/(jpeg|png|webp);base64,/i.test(image)
    ) {
      return res.status(400).json({
        error: "Envie uma fotografia JPG, PNG ou WEBP válida."
      });
    }

    if (image.length > 12 * 1024 * 1024) {
      return res.status(413).json({
        error: "Fotografia muito grande. Reduza o tamanho."
      });
    }

    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 12000
    ) {
      return res.status(400).json({
        error: "Informe as instruções de edição."
      });
    }

    // Intensidades disponíveis
    const validIntensities = [
      "natural",
      "professional",
      "creative",
      "identity"
    ];

    const selectedIntensity = validIntensities.includes(intensity)
      ? intensity
      : "natural";

    // Instruções específicas de cada modo
    const intensityInstructions = {
      identity: `
MODO: PRESERVAÇÃO DE IDENTIDADE — PRIORIDADE MÁXIMA

OBJETIVO:
- Faça somente as alterações solicitadas pelo usuário.
- Preserve a pessoa da fotografia original como referência visual obrigatória.
- Quando o usuário pedir mudança de cenário, concentre a edição no fundo e no ambiente.

PRESERVAÇÃO DA PESSOA:
- Preserve a identidade e os traços faciais da pessoa original.
- Não redesenhe, reinterprete, embeleze ou substitua o rosto.
- Mantenha formato do rosto, olhos, sobrancelhas, nariz, boca, queixo e mandíbula.
- Preserve idade aparente, expressão, cabelo, linha do cabelo, tom e textura natural da pele.
- Não afine, aumente ou reduza o rosto ou o corpo.
- Preserve proporções físicas, pose, roupa e posição da pessoa.
- Não invente características físicas nem transforme a pessoa em alguém apenas semelhante.

ALTERAÇÕES DE CENÁRIO:
- Se for solicitado outro ambiente, substitua o fundo de forma clara e coerente.
- Não mantenha o cenário original quando o pedido exigir sua substituição.
- Integre a pessoa ao novo ambiente com perspectiva, iluminação e sombras naturais.
- Não altere a pessoa para adaptar o cenário; adapte o cenário à pessoa.

RESULTADO:
- Aparência de fotografia real, sem aspecto de montagem.
- Preserve detalhes naturais e textura da pele.
- Não adicione textos, molduras ou marcas d'água.
      `,

      natural: `
NÍVEL DE EDIÇÃO: NATURAL (PRESERVAÇÃO MÁXIMA)
- Trate a imagem como uma fotografia real que precisa de correções discretas.
- Preserve rigorosamente a identidade da pessoa e a geometria facial.
- Não redesenhe nem reinterprete rosto, olhos, sobrancelhas, nariz, boca, orelhas, queixo ou mandíbula.
- Não altere idade aparente, expressão, cabelo, linha do cabelo, tom de pele, formato corporal ou proporções.
- Não afine o rosto ou o corpo e não aplique embelezamento automático.
- Preserve poros, linhas de expressão, marcas naturais e textura real da pele.
- Faça apenas ajustes sutis de exposição, balanço de branco, contraste, cor e ruído, quando necessários.
- Preserve pose, roupa, enquadramento e fundo, exceto quando o usuário pedir expressamente uma mudança.
- Se uma alteração solicitada entrar em conflito com a preservação da identidade, priorize a identidade.
      `,

      professional: `
NÍVEL DE EDIÇÃO: PROFISSIONAL
- Preserve a identidade, a geometria facial, a idade aparente e as proporções físicas.
- Melhore iluminação, exposição, balanço de branco, contraste, cores e nitidez com acabamento fotográfico profissional.
- Mantenha textura natural da pele; não aplique efeito de pele plástica.
- Não altere traços faciais, corpo, pose ou vestuário, salvo pedido explícito.
- Evite filtros exagerados e aparência artificial.
      `,
