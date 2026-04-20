require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const os = require("os");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 5000;
let gmailMcpRuntimePromise = null;

app.use(cors());
app.use(express.json());

function getMcpConfigPath() {
  return process.env.MCP_CONFIG_PATH || path.join(os.homedir(), ".cursor", "mcp.json");
}

async function getGmailMcpRuntime() {
  if (gmailMcpRuntimePromise) {
    return gmailMcpRuntimePromise;
  }

  gmailMcpRuntimePromise = (async () => {
    const configPath = getMcpConfigPath();
    const raw = await fs.promises.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const servers = parsed?.mcpServers || {};

    const preferredServer = process.env.GMAIL_MCP_SERVER_NAME || "user-gmail";
    const serverName = servers[preferredServer]
      ? preferredServer
      : Object.keys(servers).find((name) => /gmail/i.test(name)) || Object.keys(servers)[0];
    const serverConfig = serverName ? servers[serverName] : null;

    if (!serverConfig) {
      throw new Error(
        `No MCP server found in ${configPath}. Add a Gmail MCP server under mcpServers.`
      );
    }

    if (!serverConfig.command) {
      throw new Error(
        `MCP server "${serverName}" must use command/args format in ${configPath}.`
      );
    }

    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

    const client = new Client(
      { name: "learning-path-generator-backend", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: Array.isArray(serverConfig.args) ? serverConfig.args : [],
      env: {
        ...process.env,
        ...(serverConfig.env || {}),
      },
    });

    await client.connect(transport);
    const listed = await client.listTools();
    const tools = Array.isArray(listed?.tools) ? listed.tools : [];

    const toolName =
      process.env.GMAIL_MCP_TOOL_NAME ||
      tools.find((tool) => /(send|mail|gmail)/i.test(tool.name))?.name;

    if (!toolName) {
      throw new Error(`No Gmail send tool found on MCP server "${serverName}".`);
    }

    return { client, toolName, serverName };
  })();

  return gmailMcpRuntimePromise;
}

function buildRoadmapEmailText(goal, skills, roadmap) {
  const stepLines = roadmap.steps
    .map((step, index) => {
      if (step && typeof step === "object") {
        const title = String(step.title || `Step ${index + 1}`).trim();
        const description = String(step.description || "").trim();
        return `- ${title}: ${description}`;
      }
      return `- ${String(step).trim()}`;
    })
    .join("\n");
  const resourceLines = roadmap.resources.map((item) => `- ${item}`).join("\n");

  return [
    "Your Personalized Learning Roadmap",
    "",
    `Goal: ${goal}`,
    `Skills: ${skills.join(", ")}`,
    "",
    "Steps:",
    stepLines || "- No steps generated",
    "",
    "Resources:",
    resourceLines || "- No resources generated",
  ].join("\n");
}

function buildFormattedRoadmap(steps, resources) {
  const formatStep = (step, fallbackIndex) => {
    if (!step) {
      return "Not generated";
    }
    if (typeof step === "object") {
      const title = String(step.title || `Step ${fallbackIndex}`).trim();
      const description = String(step.description || "").trim();
      return description ? `${title} - ${description}` : title;
    }
    return String(step).trim();
  };

  const step1 = formatStep(steps[0], 1);
  const step2 = formatStep(steps[1], 2);
  const resourceLines = resources.length
    ? resources.map((item) => `- ${item}`).join("\n")
    : "- No resources generated";

  return [`Step 1: ${step1}`, `Step 2: ${step2}`, "Resources:", resourceLines].join("\n");
}

function buildFallbackRoadmap(skills, goal) {
  return {
    steps: [
      {
        title: "Step 1: Strengthen Fundamentals",
        description: `Revise core concepts in ${skills.join(
          ", "
        )} and practice with 2-3 small exercises.`,
      },
      {
        title: "Step 2: Build Goal-Oriented Project",
        description: `Create one mini project aligned with "${goal}" and iterate weekly.`,
      },
      {
        title: "Step 3: Advance and Showcase",
        description:
          "Learn one advanced topic, improve your project, and publish it in a portfolio.",
      },
    ],
    resources: [
      "Official documentation for your core skills",
      "FreeCodeCamp or similar guided curriculum",
      "GitHub portfolio with weekly progress updates",
    ],
  };
}

async function generateWithGemini(apiKey, prompt) {
  const modelCandidates = [
    "gemini-pro",
    "gemini-pro-latest",
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-flash-latest",
  ];
  let lastError = null;

  for (const model of modelCandidates) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );

      return response.data;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const code = error?.response?.data?.error?.code;
      if (status !== 404 && code !== 404) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

async function sendRoadmapEmailViaMcp({ to, subject, body }) {
  const runtime = await getGmailMcpRuntime();
  const payloadCandidates = [
    { to, subject, body },
    { recipient: to, subject, body },
    { email_address: to, subject, body },
    { to: [to], subject, body },
    { message: { to, subject, body } },
  ];

  let lastError = null;
  for (const args of payloadCandidates) {
    try {
      const result = await runtime.client.callTool({
        name: runtime.toolName,
        arguments: args,
      });
      return {
        server: runtime.serverName,
        tool: runtime.toolName,
        result,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Failed to send email via MCP tool "${runtime.toolName}": ${lastError?.message || "Unknown error"}`
  );
}

app.get("/", (req, res) => {
  res.json({ message: "Express server running" });
});

app.post("/generate", async (req, res) => {
  const { skills, goal, email } = req.body;

  const normalizedSkills = Array.isArray(skills)
    ? skills.map((skill) => String(skill).trim()).filter(Boolean)
    : [];
  const normalizedGoal = typeof goal === "string" ? goal.trim() : "";
  const normalizedEmail = typeof email === "string" ? email.trim() : "";

  if (!normalizedSkills.length || !normalizedGoal) {
    return res.status(400).json({
      error: "'skills' (array) and 'goal' (string) are required.",
    });
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return res.status(500).json({
      error: "Missing GEMINI_API_KEY in environment.",
    });
  }

  const prompt = `Create a structured learning roadmap for:
Skills: ${normalizedSkills.join(", ")}
Goal: ${normalizedGoal}

Return strictly in JSON format:
{
  "steps": [
    { "title": "", "description": "" }
  ],
  "resources": [],
  "videos": [
    { "title": "...", "url": "https://youtube.com/results?search_query=..." }
  ]
}`;

  try {
    const data = await generateWithGemini(geminiApiKey, prompt);
    const modelText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    if (!modelText) {
      return res.status(502).json({
        error: "Gemini returned an empty response.",
      });
    }

    let parsed;
    let formattedRoadmap = "";
    let videos = [];
    try {
      parsed = JSON.parse(modelText);
    } catch (parseError) {
      parsed = { steps: [], resources: [] };
      formattedRoadmap = modelText;
      videos = [
        {
          title: `${normalizedGoal} tutorial`,
          url: `https://www.youtube.com/results?search_query=${encodeURIComponent(normalizedGoal)}`,
        },
      ];
    }

    const steps = Array.isArray(parsed.steps)
      ? parsed.steps
          .map((step, index) => {
            if (!step || typeof step !== "object") {
              return null;
            }
            const title = String(step.title || `Step ${index + 1}`).trim();
            const description = String(step.description || "").trim();
            return { title, description };
          })
          .filter(Boolean)
      : [];
    const resources = Array.isArray(parsed.resources)
      ? parsed.resources.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (!videos.length) {
      videos = Array.isArray(parsed.videos)
        ? parsed.videos
            .map((video) => {
              if (!video || typeof video !== "object") {
                return null;
              }
              const title = String(video.title || "").trim();
              const url = String(video.url || "").trim();
              if (!title || !url) {
                return null;
              }
              return { title, url };
            })
            .filter(Boolean)
        : [];
    }
    if (!videos.length) {
      videos = [
        {
          title: `${normalizedGoal} tutorial`,
          url: `https://www.youtube.com/results?search_query=${encodeURIComponent(normalizedGoal)}`,
        },
      ];
    }

    const roadmap = {
      steps,
      resources,
    };
    if (!formattedRoadmap) {
      formattedRoadmap = buildFormattedRoadmap(steps, resources);
    }

    const responsePayload = {
      success: true,
      data: {
        roadmap,
        formattedRoadmap,
        videos,
      },
    };

    if (normalizedEmail) {
      const subject = `Your learning roadmap: ${normalizedGoal}`;
      const emailBody = buildRoadmapEmailText(normalizedGoal, normalizedSkills, roadmap);

      const emailSend = await sendRoadmapEmailViaMcp({
        to: normalizedEmail,
        subject,
        body: emailBody,
      });

      responsePayload.emailSent = true;
    }

    return res.json(responsePayload);
  } catch (error) {
    const status = error?.response?.status;
    const code = error?.response?.data?.error?.status;
    if (status === 429 || code === "RESOURCE_EXHAUSTED") {
      const roadmap = buildFallbackRoadmap(normalizedSkills, normalizedGoal);
      return res.json({
        success: true,
        data: {
          roadmap,
          formattedRoadmap:
            "Gemini API quota exceeded for this key. Showing fallback roadmap. Please enable billing or use a key with available quota.",
          videos: [
            {
              title: `${normalizedGoal} tutorial`,
              url: `https://www.youtube.com/results?search_query=${encodeURIComponent(normalizedGoal)}`,
            },
          ],
        },
      });
    }

    const details = error.response?.data || error.message;
    return res.status(500).json({
      error: "Failed to generate roadmap.",
      details,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
