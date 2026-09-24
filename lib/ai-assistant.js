// AI Assistant backend: streams chat replies from Claude (Anthropic API, via
// the official SDK) or a local Ollama server. The API key lives in the
// encrypted secure store and never reaches the renderer.

const Anthropic = require("@anthropic-ai/sdk");

const AnthropicClient = Anthropic.default || Anthropic;

const CLAUDE_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
];
const DEFAULT_CONFIG = {
  provider: "claude",
  claudeModel: "claude-opus-5",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: ""
};

function buildSystemPrompt(context) {
  const lines = [
    "You are the coding assistant inside WP Desktop, a Windows app for building WordPress sites locally (XAMPP/Laragon, WP-CLI, SFTP deploys).",
    "Help with PHP, WordPress themes and plugins, SQL, JavaScript, CSS, local server configuration and deployment.",
    "Prefer WordPress coding standards and core APIs (hooks, WP_Query, $wpdb->prepare, nonces, escaping). Use fenced code blocks with a language tag."
  ];
  if (context?.site) {
    const site = context.site;
    lines.push(
      "",
      "The user's currently selected site:",
      `- Name: ${site.name || "unknown"}`,
      site.siteUrl ? `- Local URL: ${site.siteUrl}` : "",
      site.path ? `- Folder: ${site.path}` : "",
      site.wordpressVersion ? `- WordPress: ${site.wordpressVersion}` : "",
      site.phpVersion ? `- PHP: ${site.phpVersion}` : "",
      site.webServer ? `- Web server: ${site.webServer}` : ""
    );
  }
  return lines.filter((line) => line !== "").join("\n");
}

function sanitizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => (message.role === "user" || message.role === "assistant") && String(message.content || "").trim())
    .slice(-40)
    .map((message) => ({ role: message.role, content: String(message.content) }));
}

function createAiAssistant({ secureStore }) {
  const active = new Map();

  function getConfig() {
    return { ...DEFAULT_CONFIG, ...(secureStore.get("ai.config") || {}) };
  }

  function getPublicConfig() {
    return { ...getConfig(), hasClaudeKey: secureStore.has("ai.anthropicKey"), claudeModels: CLAUDE_MODELS };
  }

  function saveConfig(input = {}) {
    const next = { ...getConfig() };
    if (input.provider === "claude" || input.provider === "ollama") {
      next.provider = input.provider;
    }
    if (CLAUDE_MODELS.some((model) => model.id === input.claudeModel)) {
      next.claudeModel = input.claudeModel;
    }
    if (typeof input.ollamaUrl === "string" && input.ollamaUrl.trim()) {
      next.ollamaUrl = input.ollamaUrl.trim().replace(/\/+$/, "");
    }
    if (typeof input.ollamaModel === "string") {
      next.ollamaModel = input.ollamaModel.trim();
    }
    secureStore.set("ai.config", next);
    if (typeof input.anthropicKey === "string") {
      secureStore.set("ai.anthropicKey", input.anthropicKey.trim());
    }
    return getPublicConfig();
  }

  async function listOllamaModels(url = getConfig().ollamaUrl) {
    const response = await fetch(`${url.replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) {
      throw new Error(`Ollama responded with HTTP ${response.status}.`);
    }
    const data = await response.json();
    return (data.models || []).map((model) => ({ id: model.name, sizeBytes: model.size }));
  }

  async function streamClaude({ messages, system, signal, emit }) {
    const apiKey = secureStore.get("ai.anthropicKey");
    if (!apiKey) {
      throw new Error("Add your Anthropic API key in the assistant settings first.");
    }
    const config = getConfig();
    const client = new AnthropicClient({ apiKey });
    const model = config.claudeModel;
    const params = {
      model,
      max_tokens: 64000,
      system,
      messages
    };
    if (model !== "claude-haiku-4-5") {
      params.thinking = { type: "adaptive" };
    }
    if (model === "claude-opus-5") {
      // Re-run policy declines on Anthropic's recommended fallback model.
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    const stream = client.beta.messages.stream(params, { signal });
    stream.on("text", (text) => emit({ type: "delta", text }));
    let message;
    try {
      message = await stream.finalMessage();
    } catch (error) {
      if (error instanceof AnthropicClient.AuthenticationError) {
        throw new Error("Anthropic rejected the API key. Check it in the assistant settings.");
      }
      if (error instanceof AnthropicClient.RateLimitError) {
        throw new Error("Anthropic rate limit reached. Wait a moment and try again.");
      }
      if (error instanceof AnthropicClient.APIError) {
        throw new Error(`Anthropic API error ${error.status ?? ""}: ${error.message}`.trim());
      }
      throw error;
    }
    if (message.stop_reason === "refusal") {
      emit({ type: "notice", text: "Claude declined to answer this request." });
    } else if (message.stop_reason === "max_tokens") {
      emit({ type: "notice", text: "The reply hit the length limit and was cut off." });
    }
    return { model: message.model, usage: message.usage };
  }

  async function streamOllama({ messages, system, signal, emit }) {
    const config = getConfig();
    if (!config.ollamaModel) {
      throw new Error("Pick an Ollama model in the assistant settings first.");
    }
    let response;
    try {
      response = await fetch(`${config.ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.ollamaModel, stream: true, messages: [{ role: "system", content: system }, ...messages] }),
        signal
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }
      throw new Error(`Can't reach Ollama at ${config.ollamaUrl}. Is it running?`);
    }
    if (!response.ok) {
      throw new Error(`Ollama error (HTTP ${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) {
          continue;
        }
        const data = JSON.parse(line);
        if (data.error) {
          throw new Error(`Ollama: ${data.error}`);
        }
        if (data.message?.content) {
          emit({ type: "delta", text: data.message.content });
        }
      }
    }
    return { model: config.ollamaModel };
  }

  async function chat({ requestId, messages, context }, emit) {
    const controller = new AbortController();
    active.set(requestId, controller);
    const payload = {
      messages: sanitizeMessages(messages),
      system: buildSystemPrompt(context),
      signal: controller.signal,
      emit
    };
    if (!payload.messages.length || payload.messages[payload.messages.length - 1].role !== "user") {
      active.delete(requestId);
      throw new Error("Nothing to send.");
    }
    const provider = getConfig().provider;
    try {
      const result = provider === "ollama" ? await streamOllama(payload) : await streamClaude(payload);
      emit({ type: "done", provider, ...result });
    } catch (error) {
      if (controller.signal.aborted) {
        emit({ type: "done", provider, cancelled: true });
      } else {
        emit({ type: "error", message: error.message });
      }
    } finally {
      active.delete(requestId);
    }
  }

  function cancel(requestId) {
    const controller = active.get(requestId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  return { getPublicConfig, saveConfig, listOllamaModels, chat, cancel };
}

module.exports = { createAiAssistant, CLAUDE_MODELS };
