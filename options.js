// options.js

const ext = typeof browser !== "undefined" ? browser : chrome;

// Keep this in sync with background.js defaults
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

const apiKeyInput = document.getElementById("apiKey");
const geminiApiKeyInput = document.getElementById("geminiApiKey");
const downloadPathInput = document.getElementById("downloadPath");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("saveBtn");

const modelRowsEl = document.getElementById("modelRows");
const addModelBtn = document.getElementById("addModelBtn");

function addModelRow(model) {
  const tr = document.createElement("tr");
  tr.className = "model-row";

  const labelTd = document.createElement("td");
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "model-label";
  labelInput.placeholder = "e.g. OpenAI - gpt-4.1";
  labelInput.value = model.label || model.name || "";
  labelTd.appendChild(labelInput);

  const modelTd = document.createElement("td");
  const modelInput = document.createElement("input");
  modelInput.type = "text";
  modelInput.className = "model-model";
  modelInput.placeholder = "e.g. gpt-4.1 or gemini-2.5-flash";
  modelInput.value = model.model || "";
  modelTd.appendChild(modelInput);

  const providerTd = document.createElement("td");
  const providerSelect = document.createElement("select");
  providerSelect.className = "model-provider";

  const optOpenAI = document.createElement("option");
  optOpenAI.value = "openai";
  optOpenAI.textContent = "OpenAI";

  const optGemini = document.createElement("option");
  optGemini.value = "gemini";
  optGemini.textContent = "Google Gemini";

  providerSelect.appendChild(optOpenAI);
  providerSelect.appendChild(optGemini);

  providerSelect.value = model.provider || "openai";
  providerTd.appendChild(providerSelect);

  const actionsTd = document.createElement("td");
  actionsTd.className = "actions-cell";
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.textContent = "Delete";
  delBtn.className = "small danger";
  delBtn.addEventListener("click", () => {
    tr.remove();
  });
  actionsTd.appendChild(delBtn);

  tr.appendChild(labelTd);
  tr.appendChild(modelTd);
  tr.appendChild(providerTd);
  tr.appendChild(actionsTd);

  modelRowsEl.appendChild(tr);
}

function renderModels(models) {
  modelRowsEl.innerHTML = "";
  (models || []).forEach((m) => addModelRow(m));
  if (!models || !models.length) {
    addModelRow({ provider: "openai", label: "", model: "" });
  }
}

async function loadSettings() {
  const data = await ext.storage.local.get({
    openaiApiKey: "",
    geminiApiKey: "",
    downloadPath: "repro-wizard",
    models: DEFAULT_MODELS
  });

  apiKeyInput.value = data.openaiApiKey || "";
  geminiApiKeyInput.value = data.geminiApiKey || "";
  downloadPathInput.value = data.downloadPath || "repro-wizard";

  renderModels(data.models);
}

function collectModelsFromDOM() {
  const rows = Array.from(modelRowsEl.querySelectorAll(".model-row"));
  const models = [];

  rows.forEach((row, index) => {
    const labelInput = row.querySelector(".model-label");
    const modelInput = row.querySelector(".model-model");
    const providerSelect = row.querySelector(".model-provider");

    const label = (labelInput && labelInput.value.trim()) || "";
    const modelId = (modelInput && modelInput.value.trim()) || "";
    const provider = (providerSelect && providerSelect.value) || "openai";

    if (!modelId) {
      return; // ignore empty rows
    }

    models.push({
      id: `model-${index}`,
      label: label || modelId,
      provider,
      model: modelId
    });
  });

  return models;
}

async function saveSettings() {
  const key = apiKeyInput.value.trim();
  const geminiKey = geminiApiKeyInput.value.trim();
  const downloadPath = downloadPathInput.value.trim() || "repro-wizard";
  const models = collectModelsFromDOM();

  await ext.storage.local.set({
    openaiApiKey: key,
    geminiApiKey: geminiKey,
    downloadPath,
    models
  });

  // Ask background script to rebuild context menus with the new models.
  try {
    await ext.runtime.sendMessage({ type: "bugtest-refresh-menus" });
  } catch (err) {
    console.warn("Failed to refresh menus after saving models", err);
  }

  statusEl.textContent = "Saved.";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 2000);
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettings().catch((err) => {
    console.error("Failed to load settings", err);
    statusEl.textContent = "Error loading settings (see console).";
  });

  addModelBtn.addEventListener("click", () => {
    addModelRow({ provider: "openai", label: "", model: "" });
  });

  saveBtn.addEventListener("click", () => {
    saveSettings().catch((err) => {
      console.error("Failed to save settings", err);
      statusEl.textContent = "Error saving settings (see console).";
    });
  });
});
