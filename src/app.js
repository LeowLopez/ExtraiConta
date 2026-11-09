import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker, OEM } from "tesseract.js";
import packageInfo from "../package.json";
import "./theme.js";
import {
  FIELD_DEFINITIONS,
  INFO_DEFINITIONS,
  STORAGE_KEY,
  createDefaultConfig,
  extractInvoice,
  validateConfig,
} from "./extraction.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const BASE_URL = import.meta.env.BASE_URL;
const APP_ROOT = new URL(BASE_URL, window.location.origin);
const appAssetUrl = (path) => new URL(path, APP_ROOT).href;
const ui = {
  fileInput: document.querySelector("#pdf-input"),
  fileName: document.querySelector("#file-name"),
  dropzone: document.querySelector("#dropzone"),
  processButton: document.querySelector("#process-button"),
  appStatus: document.querySelector("#app-status"),
  progressRegion: document.querySelector("#progress-region"),
  progressMessage: document.querySelector("#progress-message"),
  progressValue: document.querySelector("#progress-value"),
  progressBar: document.querySelector("#progress-bar"),
  resultState: document.querySelector("#result-state"),
  resultList: document.querySelector("#result-list"),
  issueDate: document.querySelector("#issue-date"),
  dueDate: document.querySelector("#due-date"),
  tariffFlag: document.querySelector("#tariff-flag"),
  configFields: document.querySelector("#config-fields"),
  configStatus: document.querySelector("#config-status"),
  privacyChip: document.querySelector(".privacy-chip"),
  privacyStrip: document.querySelector(".privacy-strip"),
  updateNotice: document.querySelector("#update-notice"),
};

const installedApp = isInstalledApp();
let selectedFile = null;
let currentConfig = loadConfig();
let ocrWorkerPromise = null;
let installPrompt = null;

document.querySelector("#app-version").textContent = `VERSÃO ${packageInfo.version}`;
ui.privacyChip.hidden = !installedApp;
ui.privacyStrip.hidden = !installedApp;
renderConfig();
bindNavigation();
bindFileSelection();
bindConfigurationActions();
bindInstallPrompt();
registerServiceWorker();
if (location.hash === "#configuracao") showView("settings");

function loadConfig() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return createDefaultConfig();
  try {
    return validateConfig(JSON.parse(saved));
  } catch (error) {
    ui.appStatus.textContent = `As regras salvas não puderam ser usadas: ${error.message} Restaure os padrões ou importe um arquivo válido.`;
    return createDefaultConfig();
  }
}

function bindNavigation() {
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.viewTarget));
  });
}

function showView(name) {
  const extractActive = name === "extract";
  document.querySelector("#extract-view").hidden = !extractActive;
  document.querySelector("#settings-view").hidden = extractActive;
  document.querySelector("#extract-view").classList.toggle("active", extractActive);
  document.querySelector("#settings-view").classList.toggle("active", !extractActive);
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === name);
  });
  if (name === "settings") history.replaceState(null, "", `${location.pathname}#configuracao`);
  else history.replaceState(null, "", location.pathname);
}

function bindFileSelection() {
  ui.fileInput.addEventListener("change", () => setSelectedFile(ui.fileInput.files[0]));
  ui.processButton.addEventListener("click", processSelectedFile);

  for (const eventName of ["dragenter", "dragover"]) {
    ui.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      ui.dropzone.classList.add("drag-over");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    ui.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      ui.dropzone.classList.remove("drag-over");
    });
  }
  ui.dropzone.addEventListener("drop", (event) => {
    const file = [...(event.dataTransfer?.files ?? [])].find((item) =>
      item.type === "application/pdf" || item.name.toLowerCase().endsWith(".pdf"),
    );
    if (file) setSelectedFile(file);
    else setStatus("Selecione um arquivo PDF.", "error");
  });
}

function setSelectedFile(file) {
  if (!file) {
    selectedFile = null;
    ui.processButton.disabled = true;
    ui.fileName.textContent = "Arraste o PDF para cá";
    return;
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    selectedFile = null;
    ui.processButton.disabled = true;
    ui.fileName.textContent = "Arraste o PDF para cá";
    setStatus("O arquivo selecionado não parece ser um PDF.", "error");
    return;
  }
  selectedFile = file;
  ui.fileName.textContent = file.name;
  ui.processButton.disabled = false;
  ui.resultState.textContent = "Pronto para analisar";
  ui.resultState.className = "state-pill";
  setStatus("Arquivo selecionado. A leitura será feita neste navegador, sem enviar a fatura.");
}

async function processSelectedFile() {
  if (!selectedFile) return;
  setBusy(true);
  clearResults();
  try {
    setProgress("Lendo o documento", 0);
    const lines = await readPdfLines(selectedFile);
    if (!lines.length) throw new Error("Não foi possível reconhecer texto ou imagem legível neste PDF.");
    const result = extractInvoice(lines, currentConfig);
    renderResults(result);
    const measurementCount = FIELD_DEFINITIONS.filter((field) => field.measure).length;
    const extracted = FIELD_DEFINITIONS
      .filter((definition) => definition.measure && result.fields[definition.id].status === "review").length;
    const missing = Object.values(result.fields).filter((field) => field.value === null).length;
    ui.resultState.textContent = extracted === 0 ? "Medições não localizadas" : missing ? "Leitura parcial" : "Pronto para revisar";
    ui.resultState.className = extracted === 0 ? "state-pill state-error" : missing ? "state-pill state-review" : "state-pill state-ready";
    if (extracted === 0) {
      const meterMessage = currentConfig.meterNumber
        ? `Não encontramos medições para o medidor configurado (${currentConfig.meterNumber}).`
        : "Não identificamos automaticamente o número do medidor.";
      setStatus(`${meterMessage} Em Configuração, informe o número que aparece na coluna “Medidor” da tabela de leituras da fatura. Confira também se a tabela está legível.`, "error");
    } else {
      const missingMessage = missing ? ` ${missing} campo(s) ficaram sem valor; preencha apenas depois de conferir a fatura.` : "";
      const total = result.fields.valor_bruto.status === "review" ? " O valor bruto também foi localizado." : "";
      const meterMessage = currentConfig.meterNumber ? "" : " O número do medidor foi identificado automaticamente.";
      setStatus(`${extracted} de ${measurementCount} medições foram localizadas.${meterMessage}${total}${missingMessage} Confira os valores e a linha de origem antes de copiar.`);
    }
  } catch (error) {
    ui.resultState.textContent = "Leitura não concluída";
    ui.resultState.className = "state-pill state-error";
    setStatus(`Não foi possível processar a fatura: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function readPdfLines(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const allLines = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setProgress(`Lendo página ${pageNumber} de ${pdf.numPages}`, (pageNumber - 1) / pdf.numPages);
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageLines = textItemsToLines(textContent.items);
      const readableText = pageLines.join(" ").replace(/\s/g, "");
      if (readableText.length >= 20) {
        allLines.push(...pageLines);
      } else {
        const ocrLines = await recognizePage(page, pageNumber, pdf.numPages);
        allLines.push(...ocrLines);
      }
    }
  } finally {
    await pdf.destroy();
  }
  return allLines.filter((line) => line.trim());
}

function textItemsToLines(items) {
  const positioned = items
    .filter((item) => typeof item.str === "string" && item.str.trim())
    .map((item) => ({
      text: item.str,
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }))
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const groups = [];
  for (const item of positioned) {
    let group = groups.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
    if (!group) {
      group = { y: item.y, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups
    .sort((left, right) => right.y - left.y)
    .map((group) => group.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker("por+eng", OEM.LSTM_ONLY, {
      workerPath: appAssetUrl("tesseract/worker.min.js"),
      corePath: appAssetUrl("tesseract/"),
      langPath: appAssetUrl("tessdata/"),
      cacheMethod: "write",
      logger: (event) => {
        if (event.status === "recognizing text") {
          setProgress(`OCR: ${Math.round((event.progress ?? 0) * 100)}%`, event.progress ?? 0);
        } else if (event.status) {
          setProgress(`Preparando OCR: ${event.status}`, event.progress ?? 0);
        }
      },
    });
  }
  try {
    return await ocrWorkerPromise;
  } catch (error) {
    ocrWorkerPromise = null;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`OCR indisponível. Conecte-se à internet uma vez para carregar os modelos e tente novamente. Detalhe: ${reason}`);
  }
}

async function recognizePage(page, pageNumber, totalPages) {
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 2600 / Math.max(viewport.width, viewport.height));
  const canvas = document.createElement("canvas");
  const scaledViewport = page.getViewport({ scale: Math.max(1, scale) });
  canvas.width = Math.ceil(scaledViewport.width);
  canvas.height = Math.ceil(scaledViewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("O navegador não conseguiu preparar a página para OCR.");
  await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
  setProgress(`Reconhecendo imagem ${pageNumber} de ${totalPages}`, pageNumber / totalPages);
  const worker = await getOcrWorker();
  const result = await worker.recognize(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return result.data.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function renderResults(result) {
  ui.resultList.replaceChildren();
  const definitions = [
    ...FIELD_DEFINITIONS,
    ...currentConfig.customFields.map((field) => ({
      id: `custom_${field.id}`,
      label: field.label,
      kind: "number",
    })),
  ];
  for (const definition of definitions) {
    const field = result.fields[definition.id];
    const card = document.createElement("article");
    card.className = "result-row";
    const content = document.createElement("div");
    content.className = "result-value";
    const label = document.createElement("label");
    label.className = "result-label";
    label.htmlFor = `result-${definition.id}`;
    label.textContent = definition.label;
    const input = document.createElement("input");
    input.id = `result-${definition.id}`;
    input.className = "result-input";
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = field.value === null ? "" : formatFieldValue(field.value, definition.kind);
    input.placeholder = "Não localizado — confira a fatura";
    input.setAttribute("aria-label", `${definition.label}; revise ou edite o valor`);
    input.addEventListener("input", () => {
      card.classList.toggle("manual-entry", input.value.length > 0);
      card.classList.toggle("missing-result", input.value.length === 0);
      fieldStatus.className = `field-status ${input.value.trim() ? "field-status-manual" : "field-status-missing"}`;
      fieldStatus.textContent = input.value.trim()
        ? "Valor preenchido manualmente · confira antes de copiar"
        : "Não encontrado · confira a fatura";
    });
    const fieldStatus = document.createElement("span");
    fieldStatus.className = `field-status field-status-${field.status}`;
    fieldStatus.textContent = field.status === "review"
      ? "Encontrado na fatura · confira a origem"
      : field.status === "fixed"
        ? "Valor fixo do script Python · confira a configuração"
        : "Não encontrado · confira a fatura";
    content.append(label, input, fieldStatus);
    const copy = document.createElement("button");
    copy.className = "copy-button";
    copy.type = "button";
    copy.textContent = "Copiar valor";
    copy.setAttribute("aria-label", `Copiar ${definition.label}`);
    copy.setAttribute("aria-live", "polite");
    copy.addEventListener("click", () => copyField(input, copy));
    const origin = document.createElement("details");
    origin.className = "source-detail";
    const summary = document.createElement("summary");
    summary.textContent = "Ver linha de origem";
    const source = document.createElement("pre");
    source.textContent = field.sourceLine || "Nenhuma linha correspondeu à regra configurada.";
    origin.append(summary, source);
    card.append(content, copy, origin);
    if (field.value === null) card.classList.add("missing-result");
    ui.resultList.append(card);
  }
  ui.issueDate.textContent = result.info.issueDate.value || "Não localizado";
  ui.dueDate.textContent = result.info.dueDate.value || "Não localizado";
  ui.tariffFlag.textContent = result.info.tariffFlag.value || "Não localizada";
  for (const definition of INFO_DEFINITIONS) {
    const item = result.info[definition.id];
    const target = definition.id === "issueDate" ? ui.issueDate : definition.id === "dueDate" ? ui.dueDate : ui.tariffFlag;
    target.title = item.sourceLine || "Nenhum trecho correspondente foi encontrado.";
  }
}

function clearResults() {
  ui.resultList.replaceChildren();
  for (const target of [ui.issueDate, ui.dueDate, ui.tariffFlag]) {
    target.textContent = "—";
    target.removeAttribute("title");
  }
  ui.resultState.textContent = "Analisando";
  ui.resultState.className = "state-pill state-progress";
}

function formatFieldValue(value, kind) {
  const options = kind === "currency"
    ? { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { minimumFractionDigits: 3, maximumFractionDigits: 3 };
  return new Intl.NumberFormat("pt-BR", options).format(value);
}

async function copyField(input, button) {
  const value = input.value.trim();
  if (!value) {
    setStatus("Não há valor para copiar. Revise ou preencha o campo primeiro.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = "Copiado";
    button.setAttribute("aria-label", "Valor copiado");
    setTimeout(() => { button.textContent = "Copiar valor"; }, 1600);
    setTimeout(() => { button.setAttribute("aria-label", `Copiar ${input.getAttribute("aria-label").split(";")[0]}`); }, 1600);
  } catch (error) {
    setStatus(`Não foi possível copiar automaticamente: ${error.message}. Selecione e copie o valor manualmente.`, "error");
  }
}

function renderConfig() {
  ui.configFields.replaceChildren();
  const measurementCard = document.createElement("fieldset");
  measurementCard.className = "config-card";
  const measurementLegend = document.createElement("legend");
  measurementLegend.textContent = "Unidade consumidora";
  const meterLabel = document.createElement("label");
  meterLabel.className = "form-label";
  meterLabel.textContent = "Número do medidor";
  const meterInput = document.createElement("input");
  meterInput.type = "text";
  meterInput.inputMode = "numeric";
  meterInput.autocomplete = "off";
  meterInput.value = currentConfig.meterNumber;
  meterInput.dataset.meterNumber = "";
  meterLabel.append(meterInput);
  const meterHelp = document.createElement("p");
  meterHelp.className = "config-help";
  meterHelp.textContent = "Deixe vazio para tentar identificar automaticamente. Se não for encontrado, informe o número exibido na coluna “Medidor” da tabela de leituras da fatura.";
  measurementCard.append(measurementLegend, meterLabel, meterHelp);
  ui.configFields.append(measurementCard);

  const grossValueCard = document.createElement("fieldset");
  grossValueCard.className = "config-card";
  const grossValueLegend = document.createElement("legend");
  grossValueLegend.textContent = "Valor bruto da fatura";
  const grossValueLabel = document.createElement("label");
  grossValueLabel.className = "form-label";
  grossValueLabel.textContent = "Textos imediatamente antes do valor (um por linha)";
  const grossValueInput = document.createElement("textarea");
  grossValueInput.rows = 4;
  grossValueInput.value = currentConfig.grossValueAliases.join("\n");
  grossValueInput.dataset.grossValueAliases = "";
  grossValueLabel.append(grossValueInput);
  const grossValueHelp = document.createElement("p");
  grossValueHelp.className = "config-help";
  grossValueHelp.textContent = "A busca também verifica o valor logo abaixo do rótulo, como em “Valor do documento”.";
  grossValueCard.append(grossValueLegend, grossValueLabel, grossValueHelp);
  ui.configFields.append(grossValueCard);

  const infoCard = document.createElement("fieldset");
  infoCard.className = "config-card config-card-info";
  const legend = document.createElement("legend");
  legend.textContent = "Datas e bandeira tarifária";
  infoCard.append(legend);
  for (const definition of INFO_DEFINITIONS) {
    const label = document.createElement("label");
    label.className = "form-label";
    label.textContent = `${definition.label} · termos (um por linha)`;
    const textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.value = currentConfig.info[definition.id].aliases.join("\n");
    textarea.dataset.info = definition.id;
    textarea.dataset.property = "aliases";
    label.append(textarea);
    infoCard.append(label);
  }
  ui.configFields.append(infoCard);

  const customFieldsCard = document.createElement("fieldset");
  customFieldsCard.className = "config-card custom-fields-card";
  const customFieldsLegend = document.createElement("legend");
  customFieldsLegend.textContent = "Campos personalizados";
  const customFieldsHelp = document.createElement("p");
  customFieldsHelp.className = "config-help";
  customFieldsHelp.textContent = "Crie um campo numérico, informe o rótulo que aparecerá no resultado e o texto que vem imediatamente antes do valor na fatura.";
  const customFieldsList = document.createElement("div");
  customFieldsList.className = "custom-fields-list";
  customFieldsList.dataset.customFields = "";
  for (const field of currentConfig.customFields) appendCustomFieldRow(customFieldsList, field);
  const addCustomField = document.createElement("button");
  addCustomField.className = "button button-quiet";
  addCustomField.type = "button";
  addCustomField.textContent = "Adicionar campo";
  addCustomField.dataset.addCustomField = "";
  customFieldsCard.append(customFieldsLegend, customFieldsHelp, customFieldsList, addCustomField);
  ui.configFields.append(customFieldsCard);
}

function appendCustomFieldRow(container, field = {}) {
  const row = document.createElement("div");
  row.className = "custom-field-row";
  row.dataset.customFieldId = field.id || crypto.randomUUID();

  const label = document.createElement("label");
  label.className = "form-label";
  label.textContent = "Rótulo";
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.maxLength = 80;
  labelInput.value = field.label || "";
  labelInput.placeholder = "Ex.: Consumo total";
  labelInput.dataset.customLabel = "";
  label.append(labelInput);

  const prefix = document.createElement("label");
  prefix.className = "form-label";
  prefix.textContent = "Texto antes do valor";
  const prefixInput = document.createElement("input");
  prefixInput.type = "text";
  prefixInput.maxLength = 120;
  prefixInput.value = field.prefix || "";
  prefixInput.placeholder = "Ex.: Consumo total:";
  prefixInput.dataset.customPrefix = "";
  prefix.append(prefixInput);

  const remove = document.createElement("button");
  remove.className = "button button-quiet";
  remove.type = "button";
  remove.textContent = "Remover";
  remove.setAttribute("aria-label", `Remover campo ${field.label || "personalizado"}`);
  remove.addEventListener("click", () => row.remove());
  row.append(label, prefix, remove);
  container.append(row);
}

function readConfigForm() {
  const config = structuredClone(currentConfig);
  config.meterNumber = document.querySelector("[data-meter-number]").value.trim();
  config.grossValueAliases = document.querySelector("[data-gross-value-aliases]")
    .value.split(/\r?\n/).map((term) => term.trim()).filter(Boolean);
  document.querySelectorAll("[data-info]").forEach((input) => {
    config.info[input.dataset.info].aliases = input.value.split(/\r?\n/).map((term) => term.trim()).filter(Boolean);
  });
  config.customFields = [...document.querySelectorAll("[data-custom-field-id]")].map((row) => ({
    id: row.dataset.customFieldId,
    label: row.querySelector("[data-custom-label]").value.trim(),
    prefix: row.querySelector("[data-custom-prefix]").value.trim(),
  }));
  return validateConfig(config);
}

function bindConfigurationActions() {
  ui.configFields.addEventListener("click", (event) => {
    if (event.target.closest("[data-add-custom-field]")) {
      appendCustomFieldRow(document.querySelector("[data-custom-fields]"));
    }
  });
  document.querySelector("#save-config").addEventListener("click", () => {
    try {
      currentConfig = readConfigForm();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentConfig));
      ui.configStatus.textContent = "Configuração salva apenas neste navegador.";
      ui.configStatus.className = "status-message status-success";
    } catch (error) {
      ui.configStatus.textContent = `Configuração não salva: ${error.message}`;
      ui.configStatus.className = "status-message status-error";
    }
  });
  document.querySelector("#reset-config").addEventListener("click", () => {
    currentConfig = createDefaultConfig();
    localStorage.removeItem(STORAGE_KEY);
    renderConfig();
    ui.configStatus.textContent = "Regras padrão restauradas.";
    ui.configStatus.className = "status-message status-success";
  });
  document.querySelector("#export-config").addEventListener("click", () => {
    try {
      const config = readConfigForm();
      downloadJson(config, "extraiconta-regras.json");
      ui.configStatus.textContent = "Arquivo de regras exportado.";
      ui.configStatus.className = "status-message status-success";
    } catch (error) {
      ui.configStatus.textContent = `Não foi possível exportar: ${error.message}`;
      ui.configStatus.className = "status-message status-error";
    }
  });
  document.querySelector("#import-config").addEventListener("change", importConfig);
  document.querySelector("#prepare-ocr").addEventListener("click", prepareOcr);
}

async function importConfig(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = validateConfig(JSON.parse(await file.text()));
    currentConfig = imported;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentConfig));
    renderConfig();
    ui.configStatus.textContent = "Regras importadas e salvas neste navegador.";
    ui.configStatus.className = "status-message status-success";
  } catch (error) {
    ui.configStatus.textContent = `Arquivo de regras inválido: ${error.message}`;
    ui.configStatus.className = "status-message status-error";
  } finally {
    event.target.value = "";
  }
}

async function prepareOcr() {
  const button = document.querySelector("#prepare-ocr");
  button.disabled = true;
  try {
    setProgress("Baixando modelos locais de OCR", 0);
    ui.progressRegion.hidden = false;
    await getOcrWorker();
    ui.configStatus.textContent = "OCR preparado. Os modelos em português e inglês foram carregados neste navegador.";
    ui.configStatus.className = "status-message status-success";
  } catch (error) {
    ui.configStatus.textContent = `Não foi possível preparar o OCR: ${error.message}`;
    ui.configStatus.className = "status-message status-error";
  } finally {
    ui.progressRegion.hidden = true;
    button.disabled = false;
  }
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function setBusy(isBusy) {
  ui.fileInput.disabled = isBusy;
  ui.processButton.disabled = isBusy || !selectedFile;
  ui.progressRegion.hidden = !isBusy;
  if (!isBusy) {
    ui.progressBar.style.width = "100%";
    setTimeout(() => { ui.progressRegion.hidden = true; }, 700);
  }
}

function setProgress(message, progress) {
  ui.progressMessage.textContent = message;
  ui.progressValue.textContent = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  ui.progressBar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}

function setStatus(message, kind = "info") {
  ui.appStatus.textContent = message;
  ui.appStatus.className = `status-message${kind === "error" ? " status-error" : ""}`;
}

function isInstalledApp() {
  const displayModes = ["standalone", "minimal-ui", "fullscreen", "window-controls-overlay", "tabbed"];
  return displayModes.some((mode) => matchMedia(`(display-mode: ${mode})`).matches) || navigator.standalone === true;
}

async function registerServiceWorker() {
  if (import.meta.env.DEV || !("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    const registration = await navigator.serviceWorker.register(`${BASE_URL}service-worker.js`);
    const showWaitingUpdate = () => {
      if (installedApp && registration.waiting && navigator.serviceWorker.controller) showUpdateAction(registration);
    };
    const observeInstallingWorker = (worker) => {
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") showWaitingUpdate();
      });
    };
    registration.addEventListener("updatefound", () => observeInstallingWorker(registration.installing));
    observeInstallingWorker(registration.installing);
    showWaitingUpdate();
    try {
      await registration.update();
    } catch (error) {
      if (navigator.onLine) {
        setStatus(`Não foi possível verificar atualizações: ${error.message}`, "error");
      }
    }
    showWaitingUpdate();
  } catch (error) {
    setStatus(`O modo offline não pôde ser ativado: ${error.message}`, "error");
  }
}

function showUpdateAction(registration) {
  ui.updateNotice.hidden = false;
  ui.updateNotice.replaceChildren(document.createTextNode("Uma atualização do aplicativo está pronta. "));
  const button = document.createElement("button");
  button.className = "text-button";
  button.type = "button";
  button.textContent = "Atualizar agora";
  button.addEventListener("click", () => {
    const waitingWorker = registration.waiting;
    if (!waitingWorker) {
      ui.updateNotice.textContent = "A atualização já foi aplicada. Recarregue o aplicativo para continuar.";
      return;
    }
    button.disabled = true;
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  });
  ui.updateNotice.append(button);
}

function bindInstallPrompt() {
  const button = document.querySelector("#install-button");
  if (installedApp) return;
  button.hidden = false;
  button.textContent = "Instalar";

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    button.textContent = "Instalar";
    button.hidden = false;
  });
  button.addEventListener("click", async () => {
    if (!installPrompt) {
      setStatus("No Edge ou Chrome, abra o menu do navegador e escolha “Instalar ExtraiConta”. No iPhone/iPad, use Compartilhar > Adicionar à Tela de Início.");
      return;
    }

    const prompt = installPrompt;
    installPrompt = null;
    button.disabled = true;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") {
        button.hidden = true;
        setStatus("Instalação aceita. Procure ExtraiConta entre os aplicativos.");
      } else {
        setStatus("Instalação cancelada. Clique em Instalar para tentar novamente quando o navegador oferecer a opção.");
      }
    } catch (error) {
      setStatus(`Não foi possível abrir a instalação: ${error.message}. Tente pelo menu do navegador.`, "error");
    } finally {
      button.disabled = false;
    }
  });
  window.addEventListener("appinstalled", () => {
    button.hidden = true;
    installPrompt = null;
    setStatus("Aplicação instalada. Prepare o OCR online antes do primeiro uso offline.");
  });
}
