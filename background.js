// background.js (module)

const ext = typeof browser !== "undefined" ? browser : chrome;

// Default models if the user hasn't configured any yet.
// You can adjust or remove these – they're just sane starting points.
const DEFAULT_MODELS = [
  {
    id: "openai-gpt-4.1",
    label: "OpenAI - gpt-4.1",
    provider: "openai",
    model: "gpt-4.1"
  },
  {
    id: "openai-gpt-4.1-mini",
    label: "OpenAI - gpt-4.1-mini",
    provider: "openai",
    model: "gpt-4.1-mini"
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini - gemini-2.5-flash",
    provider: "gemini",
    model: "gemini-2.5-flash"
  }
];

function log(...args) {
  console.log("[ReproWizard]", ...args);
}

function stripCodeFences(text) {
  if (!text) return "";
  // Remove ```html ... ``` or ``` ... ``` fences.
  return text
    .replace(/^```[\s\S]*?\n/, "") // remove first ```... line
    .replace(/```[\s]*$/m, "")    // remove closing ```
    .trim();
}

/**
 * Read model configurations from storage, with sane defaults.
 */
async function getModelOptions() {
  const result = await ext.storage.local.get({ models: null });
  let models = result.models;

  if (!Array.isArray(models) || !models.length) {
    models = DEFAULT_MODELS;
  }

  return models.map((m, idx) => ({
    id: m.id || `model-${idx}`,
    label: m.label || m.name || m.model || `Model ${idx + 1}`,
    provider: m.provider || "openai",
    model: m.model || "gpt-4.1"
  }));
}

/**
 * (Re)create context menus based on configured models.
 */
async function ensureMenus() {
  const models = await getModelOptions();

  return new Promise((resolve) => {
    ext.contextMenus.removeAll(() => {
      // Parent menu
      ext.contextMenus.create(
        {
          id: "bugtest-root",
          title: "Generate test page",
          contexts: ["selection"]
        },
        () => {
          // One submenu per model
          models.forEach((model, index) => {
            ext.contextMenus.create({
              id: `bugtest-model-${index}`,
              parentId: "bugtest-root",
              title: model.label,
              contexts: ["selection"]
            });
          });
          resolve();
        }
      );
    });
  });
}

ext.runtime.onInstalled.addListener(() => {
  log("Extension installed, creating context menus");
  ensureMenus();
});

if (ext.runtime.onStartup) {
  ext.runtime.onStartup.addListener(() => {
    log("Runtime startup, ensuring context menus");
    ensureMenus();
  });
}

// Options page tells us to refresh menus after saving models.
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "bugtest-refresh-menus") {
    ensureMenus()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[ReproWizard] Failed to refresh menus:", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // async
  }
});

/**
 * User clicked one of our menu items.
 */
ext.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!info.selectionText) {
      log("No selectionText in context menu click");
      await openInfoTab(
        "Repro Wizard",
        "No text selected. Please select a bug report before using the menu."
      );
      return;
    }

    const id = info.menuItemId;
    const prefix = "bugtest-model-";

    if (typeof id !== "string" || !id.startsWith(prefix)) {
      return; // not ours
    }

    const idx = parseInt(id.slice(prefix.length), 10);
    const models = await getModelOptions();
    const model = models[idx];

    if (!model) {
      await openInfoTab(
        "Repro Wizard - Model not found",
        "The selected model entry could not be found. " +
          "Try opening the options page and saving your models again."
      );
      return;
    }

    const settings = await ext.storage.local.get({
      openaiApiKey: "",
      geminiApiKey: "",
      autoDownload: true
    });

    // Provider-specific key checks
    if (model.provider === "openai" && !settings.openaiApiKey) {
      await openInfoTab(
        "Repro Wizard - OpenAI setup required",
        "You selected an OpenAI model, but no OpenAI API key is configured.\n\n" +
          "Go to the extension's options page and paste your OpenAI API key.\n\n" +
          "Note: ChatGPT Plus/Pro uses a different billing system; " +
          "you still need an API key from the OpenAI platform."
      );
      return;
    }

    if (model.provider === "gemini" && !settings.geminiApiKey) {
      await openInfoTab(
        "Repro Wizard - Gemini setup required",
        "You selected a Google Gemini model, but no Gemini API key is configured.\n\n" +
          "Get a Gemini API key from Google AI Studio (aistudio.google.com), " +
          "then paste it into the extension's options page."
      );
      return;
    }

    log("Generating test page with model:", model.provider, model.model);
    const html = await generateHtmlForModel(model, info.selectionText, settings);
    const cleanedHtml = stripCodeFences(html);

    if (!cleanedHtml) {
      await openInfoTab(
        "Repro Wizard - Empty response",
        "The AI response was empty or could not be parsed."
      );
      return;
    }

    await openHtmlInNewTab(cleanedHtml, settings.autoDownload);
  } catch (err) {
    console.error("[ReproWizard] Error:", err);
    await openInfoTab(
      "Repro Wizard - Error",
      "An error occurred while generating the test page:\n\n" +
        String(err && err.message ? err.message : err)
    );
  }
});

/**
 * Dispatch to provider-specific generator.
 */
async function generateHtmlForModel(modelSpec, bugReportText, settings) {
  const provider = modelSpec.provider || "openai";

  if (provider === "openai") {
    return generateHtmlWithOpenAI(
      settings.openaiApiKey,
      modelSpec,
      bugReportText
    );
  }

  if (provider === "gemini") {
    return generateHtmlWithGemini(
      settings.geminiApiKey,
      modelSpec,
      bugReportText
    );
  }

  throw new Error("Unknown provider: " + provider);
}

/**
 * OpenAI chat completions call.
 */
async function generateHtmlWithOpenAI(apiKey, modelSpec, bugReportText) {
  const systemPrompt =
    "You are an elite front-end engineer with deep knowledge of browser " +
    "rendering, JavaScript, CSS, and Web APIs.\n" +
    "Given a bug report, you must output a SINGLE, SELF-CONTAINED HTML " +
    "test page that reproduces or illustrates the bug.\n\n" +
    "Requirements:\n" +
    "  - Use only vanilla HTML/CSS/JS (no external libraries).\n" +
    "  - Put CSS in <style> and JS in <script> inside the same HTML file.\n" +
    "  - Add concise comments explaining what the page is testing and " +
    "    how to trigger the behavior.\n" +
    "  - Add any image, audio, or video file/link in the file if necessary to reproduce the bug.\n" +
    "  - Run the test page by a button click and show the result on page.\n" +
    "  - Make page as minimal as possible. No fancy UI or extra features.\n" +
    "  - Prioritize clear variable names rather than excessive comments.\n" +
    "  - Do NOT wrap the result in markdown fences. Output ONLY raw HTML.";

  const userPrompt =
    "Bug report (from Bugzilla or similar):\n\n" + bugReportText;

  const payload = {
    model: modelSpec.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: 8000
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      "OpenAI API error: HTTP " + res.status + (text ? " - " + text : "")
    );
  }

  const data = await res.json();
  const content =
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;

  return content || "";
}

/**
 * Gemini generateContent call.
 * Docs: https://ai.google.dev/api/generate-content
 */
async function generateHtmlWithGemini(apiKey, modelSpec, bugReportText) {
  const systemPrompt =
    "You are an elite front-end engineer with deep knowledge of browser " +
    "rendering, JavaScript, CSS, and Web APIs.\n" +
    "Given a bug report, you must output a SINGLE, SELF-CONTAINED HTML " +
    "test page that reproduces or illustrates the bug.\n\n" +
    "Requirements:\n" +
    "  - Use only vanilla HTML/CSS/JS (no external libraries).\n" +
    "  - Put CSS in <style> and JS in <script> inside the same HTML file.\n" +
    "  - Add concise comments explaining what the page is testing and " +
    "    how to trigger the behavior.\n" +
    "  - Add any image, audio, or video file/link in the file if necessary to reproduce the bug.\n" +
    "  - Run the test page by a button click and show the result on page.\n" +
    "  - Make page as minimal as possible. No fancy UI or extra features.\n" +
    "  - Prioritize clear variable names rather than excessive comments.\n" +
    "  - Do NOT wrap the result in markdown fences. Output ONLY raw HTML.";

  const userPrompt =
    "Bug report (from Bugzilla or similar):\n\n" + bugReportText;

  // Gemini generateContent REST endpoint, text-only use:
  // POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=API_KEY
  // Body uses `contents` + optional `systemInstruction` + `generationConfig`. :contentReference[oaicite:3]{index=3}
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(modelSpec.model) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);

  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8000
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      "Gemini API error: HTTP " + res.status + (text ? " – " + text : "")
    );
  }

  const data = await res.json();

  // REST response: candidates[0].content.parts[].text
  const candidates = data.candidates || [];
  const first = candidates[0];
  let text = "";

  if (first && first.content && Array.isArray(first.content.parts)) {
    text = first.content.parts
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("");
  }

  return text || "";
}

/**
 * Open generated HTML in a new tab; optionally download as file too.
 */
async function openHtmlInNewTab(html, autoDownload) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  await ext.tabs.create({ url });

  if (autoDownload && ext.downloads && ext.downloads.download) {
    const fileName =
      "bug-test-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      ".html";
    try {
      await ext.downloads.download({
        url,
        filename: fileName,
        saveAs: false
      });
    } catch (e) {
      console.warn("[ReproWizard] download failed:", e);
    }
  }
}

/**
 * Simple info/error page.
 */
async function openInfoTab(title, bodyText) {
  const html =
    "<!doctype html>" +
    "<html><head><meta charset='utf-8'><title>" +
    escapeHtml(title) +
    "</title>" +
    "<style>body{font-family:sans-serif;padding:16px;background:#111;color:#eee;}" +
    "h1{font-size:18px;margin:0 0 10px;}pre{white-space:pre-wrap;background:#222;padding:8px;border-radius:4px;}</style>" +
    "</head><body>" +
    "<h1>" +
    escapeHtml(title) +
    "</h1>" +
    "<pre>" +
    escapeHtml(bodyText) +
    "</pre>" +
    "</body></html>";

  await openHtmlInNewTab(html, false);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
