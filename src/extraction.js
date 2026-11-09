export const STORAGE_KEY = "energia-clara-rules-v1";
export const DEFAULT_METER_NUMBER = "";
const DEFAULT_GROSS_VALUE_ALIASES = [
  "VALOR BRUTO",
  "TOTAL BRUTO",
  "VALOR TOTAL DA FATURA",
  "VALOR DO DOCUMENTO",
];

export const FIELD_DEFINITIONS = [
  {
    id: "consumo_fora_ponta",
    label: "Consumo Fora de Ponta (kWh)",
    kind: "number",
    measure: "ENRG ATV",
    posts: ["F PONTA", "F PONTA INDU"],
    operation: "sum",
  },
  {
    id: "consumo_na_ponta",
    label: "Consumo Na Ponta (kWh)",
    kind: "number",
    measure: "ENRG ATV",
    posts: ["PONTA"],
    operation: "first",
  },
  {
    id: "demanda_contratada_ponta",
    label: "Demanda Contratada Na Ponta (kW)",
    kind: "number",
    measure: "DEMANDA CONTRATADA",
    posts: ["PONTA"],
    operation: "first",
  },
  {
    id: "demanda_contratada_fora_ponta",
    label: "Demanda Contratada Fora de Ponta (kW)",
    kind: "number",
    measure: "DEMANDA CONTRATADA",
    posts: ["FORA PONTA", "F PONTA"],
    operation: "first",
  },
  {
    id: "demanda_faturada_fora_ponta",
    label: "Demanda Faturada no Mês Fora de Ponta (kW)",
    kind: "number",
    measure: "DEMANDA",
    posts: ["F PONTA INDU"],
    operation: "first",
  },
  {
    id: "demanda_faturada_ponta",
    label: "Demanda Faturada no Mês Na Ponta (kW)",
    kind: "number",
    measure: "DEMANDA",
    posts: ["F PONTA CAP"],
    operation: "first",
  },
  {
    id: "energia_reativa_fora_ponta",
    label: "Energia Reativa no Mês Fora de Ponta (kVArh)",
    kind: "number",
    measure: "ENRG RTV",
    posts: ["F PONTA INDU"],
    operation: "first",
  },
  {
    id: "energia_reativa_ponta",
    label: "Energia Reativa no Mês Na Ponta (kVArh)",
    kind: "number",
    measure: "ENRG RTV",
    posts: ["PONTA"],
    operation: "first",
  },
  {
    id: "valor_bruto",
    label: "Valor bruto da fatura",
    kind: "currency",
    aliases: DEFAULT_GROSS_VALUE_ALIASES,
    operation: "first",
    valueIndex: -1,
    nextLine: true,
  },
];

const LEGACY_FIELD_IDS = [
  "consumo_fora_ponta",
  "consumo_na_ponta",
  "demanda_contratada_ponta",
  "demanda_contratada_fora_ponta",
  "demanda_faturada_fora_ponta",
  "demanda_faturada_ponta",
  "energia_reativa_fora_ponta",
  "energia_reativa_ponta",
  "valor_bruto",
];

export const INFO_DEFINITIONS = [
  { id: "issueDate", label: "Data de emissão", aliases: ["DATA DE EMISSÃO", "DATA DA EMISSÃO", "EMISSÃO"] },
  { id: "dueDate", label: "Vencimento", aliases: ["DATA DE VENCIMENTO", "VENCIMENTO", "PAGAR ATÉ"] },
  { id: "tariffFlag", label: "Bandeira tarifária", aliases: ["BANDEIRA TARIFÁRIA", "BANDEIRA TARIFARIA", "BANDEIRA(S) TARIFÁRIA(S)"] },
];

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

export function createDefaultConfig() {
  return {
    version: 4,
    meterNumber: DEFAULT_METER_NUMBER,
    grossValueAliases: [...DEFAULT_GROSS_VALUE_ALIASES],
    customFields: [],
    info: Object.fromEntries(INFO_DEFINITIONS.map(({ id, aliases }) => [id, { aliases: [...aliases] }])),
  };
}

export function validateConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("O arquivo não contém uma configuração compatível.");
  }
  if (config.version === 1) config = migrateLegacyConfig(config);
  else if (config.version === 2) config = migrateVersionTwoConfig(config);
  else if (config.version === 3) config = migrateVersionThreeConfig(config);
  if (config.version !== 4 || !config.info || typeof config.info !== "object") {
    throw new Error("O arquivo não contém uma configuração compatível.");
  }
  if (typeof config.meterNumber !== "string" ||
    (config.meterNumber.trim() !== "" && !/^\d{1,30}$/.test(config.meterNumber.trim()))) {
    throw new Error("O número do medidor deve conter apenas dígitos ou ficar vazio para identificação automática.");
  }
  if (config.meterNumber !== config.meterNumber.trim()) config = { ...config, meterNumber: config.meterNumber.trim() };
  if (!Array.isArray(config.grossValueAliases) ||
    config.grossValueAliases.length > 30 ||
    config.grossValueAliases.some((alias) => typeof alias !== "string" || alias.length > 120)) {
    throw new Error('Regra inválida para "Valor bruto da fatura".');
  }
  if (!Array.isArray(config.customFields) || config.customFields.length > 20) {
    throw new Error("A configuração pode ter no máximo 20 campos personalizados.");
  }
  const customFieldIds = new Set();
  for (const field of config.customFields) {
    if (!field || typeof field.id !== "string" || !/^[\w-]{1,80}$/.test(field.id) ||
      customFieldIds.has(field.id) || typeof field.label !== "string" || !field.label.trim() ||
      field.label.length > 80 || typeof field.prefix !== "string" || !field.prefix.trim() ||
      field.prefix.length > 120) {
      throw new Error("Cada campo personalizado precisa de um rótulo e um texto anterior ao valor.");
    }
    customFieldIds.add(field.id);
  }
  for (const info of INFO_DEFINITIONS) {
    if (!config.info[info.id] || !Array.isArray(config.info[info.id].aliases) ||
      config.info[info.id].aliases.some((alias) => typeof alias !== "string")) {
      throw new Error(`Regra inválida para "${info.label}".`);
    }
  }
  return config;
}

function migrateLegacyConfig(config) {
  if (!config.fields || !config.info || typeof config.fields !== "object" || typeof config.info !== "object") {
    throw new Error("O arquivo não contém uma configuração compatível.");
  }
  for (const id of LEGACY_FIELD_IDS) {
    const rule = config.fields[id];
    if (!rule || !Array.isArray(rule.aliases) || !["first", "last", "sum"].includes(rule.operation) ||
      !Number.isInteger(rule.valueIndex) || rule.valueIndex < -1 || rule.valueIndex > 50 ||
      rule.aliases.some((alias) => typeof alias !== "string")) {
      throw new Error(`Regra inválida para "${id}".`);
    }
  }
  const migrated = createDefaultConfig();
  for (const definition of INFO_DEFINITIONS) {
    const aliases = config.info[definition.id]?.aliases;
    if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== "string")) {
      throw new Error(`Regra inválida para "${definition.label}".`);
    }
    migrated.info[definition.id].aliases = [...aliases];
  }
  return migrated;
}

function migrateVersionTwoConfig(config) {
  if (typeof config.meterNumber !== "string" || !config.info || typeof config.info !== "object") {
    throw new Error("O arquivo não contém uma configuração compatível.");
  }
  const migrated = createDefaultConfig();
  migrated.meterNumber = config.meterNumber;
  for (const definition of INFO_DEFINITIONS) {
    const aliases = config.info[definition.id]?.aliases;
    if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== "string")) {
      throw new Error(`Regra inválida para "${definition.label}".`);
    }
    migrated.info[definition.id].aliases = [...aliases];
  }
  return migrated;
}

function migrateVersionThreeConfig(config) {
  if (typeof config.meterNumber !== "string" || !config.info || typeof config.info !== "object") {
    throw new Error("O arquivo não contém uma configuração compatível.");
  }
  const migrated = createDefaultConfig();
  migrated.meterNumber = config.meterNumber;
  for (const definition of INFO_DEFINITIONS) {
    const aliases = config.info[definition.id]?.aliases;
    if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== "string")) {
      throw new Error(`Regra inválida para "${definition.label}".`);
    }
    migrated.info[definition.id].aliases = [...aliases];
  }
  return migrated;
}

export function parseLocalizedNumber(value) {
  const clean = String(value).replace(/[^\d,.-]/g, "");
  if (!clean || !/\d/.test(clean)) return null;
  let normalized = clean;
  if (clean.includes(",")) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (/\.\d{3}$/.test(clean)) {
    normalized = clean.replace(/\./g, "");
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function extractNumberCandidates(line) {
  const matches = String(line).match(/-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:[.,]\d+)?/g) ?? [];
  return matches.map(parseLocalizedNumber).filter((value) => value !== null);
}

function findMatchingLines(lines, aliases) {
  const normalizedAliases = aliases.map(normalizeText).filter(Boolean);
  if (!normalizedAliases.length) return [];
  return lines
    .map((text, index) => {
      const normalized = normalizeText(text);
      const matchedAlias = normalizedAliases
        .filter((alias) => normalized.includes(alias))
        .sort((left, right) => right.length - left.length)[0];
      return matchedAlias ? { text, index, matchedAlias } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.matchedAlias.length - left.matchedAlias.length || left.index - right.index);
}

function isNumericToken(token) {
  return /^-?\d+(?:[.,]\d+)*$/.test(token);
}

export function parseMeasurementLine(line, meterNumber = DEFAULT_METER_NUMBER, index = 0) {
  const parts = String(line).trim().split(/\s+/);
  if (!/^\d{1,30}$/.test(parts[0] ?? "") || (meterNumber && parts[0] !== meterNumber)) return null;

  let cursor = 1;
  const measureParts = [];
  while (cursor < parts.length && parts[cursor] !== "PONTA" && parts[cursor] !== "F") {
    measureParts.push(parts[cursor]);
    cursor += 1;
  }
  if (cursor === parts.length || measureParts.length === 0) return null;

  const postParts = [];
  while (cursor < parts.length && !isNumericToken(parts[cursor])) {
    postParts.push(parts[cursor]);
    cursor += 1;
  }
  if (!postParts.length) return null;

  let skippedReadings = 0;
  while (cursor < parts.length && skippedReadings < 3) {
    if (isNumericToken(parts[cursor])) skippedReadings += 1;
    cursor += 1;
  }
  if (skippedReadings !== 3 || cursor >= parts.length || !isNumericToken(parts[cursor])) return null;

  const value = parseLocalizedNumber(parts[cursor]);
  if (value === null || value <= 0) return null;
  return {
    measure: measureParts.join(" "),
    post: postParts.join(" "),
    value,
    sourceLine: String(line),
    index,
  };
}

function extractMeasurementField(measurements, definition) {
  const measure = normalizeText(definition.measure);
  const posts = definition.posts.map(normalizeText);
  const matches = measurements.filter((item) => {
    const normalizedPost = normalizeText(item.post);
    return normalizeText(item.measure).includes(measure) &&
      posts.some((post) => normalizedPost === post || normalizedPost.startsWith(`${post} `));
  });
  if (!matches.length) return { value: null, sourceLine: "", status: "missing" };
  const selected = definition.operation === "sum" ? matches : matches.slice(0, 1);
  return {
    value: selected.reduce((total, item) => total + item.value, 0),
    sourceLine: selected.map((item) => item.sourceLine).join("\n"),
    status: "review",
  };
}

function extractContractedDemand(lines, measurements, definition) {
  const label = normalizeText("DEMANDA CONTRATADA");
  const matchesPost = (sourceLine) => {
    const normalized = normalizeText(sourceLine);
    const labelIndex = normalized.indexOf(label);
    if (labelIndex < 0) return false;
    const remainder = normalized.slice(labelIndex + label.length);
    const isOutsidePeak = /\b(?:FORA(?: DE)? PONTA|F PONTA)\b/.test(remainder);
    const isPeak = /\bPONTA\b/.test(remainder) && !isOutsidePeak;
    return definition.id === "demanda_contratada_fora_ponta" ? isOutsidePeak : isPeak;
  };
  const meterMeasurement = measurements.find((item) =>
    normalizeText(item.measure).includes(label) && matchesPost(item.sourceLine),
  );
  if (meterMeasurement) {
    return { value: meterMeasurement.value, sourceLine: meterMeasurement.sourceLine, status: "review" };
  }

  const match = lines.find(matchesPost);
  if (!match) return { value: null, sourceLine: "", status: "missing" };
  const labelMatch = match.match(/DEMANDA\s+CONTRATADA/i);
  const value = extractNumberCandidates(match.slice((labelMatch?.index ?? 0) + label.length)).at(-1);
  return value === undefined
    ? { value: null, sourceLine: "", status: "missing" }
    : { value, sourceLine: match, status: "review" };
}

export function extractConfiguredField(lines, rule) {
  if (rule.fixedValue !== "" && rule.fixedValue !== null && rule.fixedValue !== undefined) {
    const value = parseLocalizedNumber(rule.fixedValue);
    return value === null
      ? { value: null, sourceLine: "", status: "invalid" }
      : { value, sourceLine: "Valor definido manualmente na configuração", status: "fixed" };
  }
  const matches = findMatchingLines(lines, rule.aliases);
  const candidates = matches.map((match) => {
    const normalizedText = normalizeText(match.text);
    const aliasIndex = normalizedText.indexOf(match.matchedAlias);
    const afterAlias = extractNumberAfter(match.text, aliasIndex + match.matchedAlias.length);
    if (afterAlias !== null) return { ...match, value: afterAlias };
    if (rule.nextLine && lines[match.index + 1]) {
      const nextLineValues = extractNumberCandidates(lines[match.index + 1]);
      if (nextLineValues.length) return { ...match, text: `${match.text}\n${lines[match.index + 1]}`, value: nextLineValues.at(-1) };
    }
    const values = extractNumberCandidates(match.text);
    const selected = rule.valueIndex === -1 ? values.at(-1) : values[rule.valueIndex];
    return selected === undefined ? null : { ...match, value: selected };
  }).filter(Boolean);
  if (!candidates.length) return { value: null, sourceLine: "", status: "missing" };
  if (rule.operation === "sum") {
    const unique = [...new Map(candidates.map((item) => [item.index, item])).values()];
    return {
      value: unique.reduce((sum, item) => sum + item.value, 0),
      sourceLine: unique.map((item) => item.text).join("\n"),
      status: "review",
    };
  }
  const selected = rule.operation === "last" ? candidates.at(-1) : candidates[0];
  return { value: selected.value, sourceLine: selected.text, status: "review" };
}

function extractNumberAfter(text, start) {
  const suffix = String(text).slice(start);
  const match = suffix.match(/^\s*[:=\-–]?\s*(?:R\$\s*)?(-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?|-?\d+(?:[.,]\d+)?)/);
  return match ? parseLocalizedNumber(match[1]) : null;
}

function parseDates(text) {
  return [...String(text).matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/g)]
    .map(([, dayText, monthText, yearText]) => {
      const day = Number(dayText);
      const month = Number(monthText);
      let year = Number(yearText);
      if (yearText.length === 2) year += year >= 50 ? 1900 : 2000;
      if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return null;
      return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
    })
    .filter(Boolean);
}

function dateColumnIndex(line, definition, infoRules) {
  const normalizedLine = normalizeText(line);
  const anchors = INFO_DEFINITIONS
    .filter((item) => item.id !== "tariffFlag")
    .map((item) => ({
      id: item.id,
      index: Math.min(...(infoRules[item.id]?.aliases ?? item.aliases)
        .map((alias) => normalizedLine.indexOf(normalizeText(alias)))
        .filter((index) => index >= 0)),
    }))
    .filter((anchor) => Number.isFinite(anchor.index))
    .sort((left, right) => left.index - right.index);
  const selected = anchors.find((anchor) => anchor.id === definition.id);
  if (!selected) return 0;
  return anchors.filter((anchor) => anchor.index < selected.index).length;
}

function extractInfo(lines, definition, rule, infoRules) {
  const matches = findMatchingLines(lines, rule.aliases);
  if (!matches.length) return { value: "", sourceLine: "", status: "missing" };
  if (definition.id === "tariffFlag") {
    const match = matches.find(({ text }) => /APLICAD/.test(normalizeText(text))) ??
      matches.find(({ text }) => /BANDEIRA\s+TARIFARIA/.test(normalizeText(text)) && !/ADICIONAL/.test(normalizeText(text)));
    if (!match) return { value: "", sourceLine: "", status: "missing" };
    const sourceLine = match.text;
    const normalizedLine = normalizeText(sourceLine).replace(/\*/g, "");
    const appliedFlag = normalizedLine.match(/APLICADA(?:\s*S)?(?:\s+NO\s+MES)?\s*[:\-]?\s*(.*)$/);
    const flagContext = appliedFlag?.[1] ?? normalizedLine;
    const flag = flagContext.match(/\b(ESCASSEZ\s+HIDRICA|VERMELHA(?:\s+PATAMAR\s+[12]| P[12])?|AMARELA|VERDE)\b/);
    const value = flag?.[1]
      .toLocaleLowerCase("pt-BR")
      .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("pt-BR")) ?? "";
    return { value, sourceLine, status: value ? "review" : "missing" };
  }
  for (const match of matches) {
    const columnIndex = dateColumnIndex(match.text, definition, infoRules);
    for (let offset = 0; offset <= 2 && match.index + offset < lines.length; offset += 1) {
      const sourceLine = lines[match.index + offset];
      const dates = parseDates(sourceLine);
      if (!dates.length) continue;
      if (offset > 0 && dates.length <= columnIndex) continue;
      const value = dates.length === 1 ? dates[0] : dates[columnIndex] ?? "";
      if (value) return { value, sourceLine, status: "review" };
    }
  }
  return { value: "", sourceLine: "", status: "missing" };
}

export function extractInvoice(lines, config) {
  config = validateConfig(config);
  const meterNumber = config.meterNumber || inferMeterNumber(lines);
  const measurements = lines
    .map((line, index) => parseMeasurementLine(line, meterNumber, index))
    .filter(Boolean);
  const fields = Object.fromEntries(FIELD_DEFINITIONS.map((definition) => {
    let result;
    if (definition.id === "demanda_contratada_ponta" || definition.id === "demanda_contratada_fora_ponta") {
      result = extractContractedDemand(lines, measurements, definition);
    } else if (definition.measure) {
      result = extractMeasurementField(measurements, definition);
    } else {
      result = extractConfiguredField(lines, {
        ...definition,
        aliases: config.grossValueAliases,
      });
    }
    return [definition.id, { ...result, kind: definition.kind }];
  }));
  for (const customField of config.customFields) {
    const result = extractConfiguredField(lines, {
      aliases: [customField.prefix],
      operation: "first",
      valueIndex: 0,
    });
    fields[`custom_${customField.id}`] = { ...result, kind: "number", label: customField.label };
  }
  const info = Object.fromEntries(INFO_DEFINITIONS.map((definition) => [
    definition.id,
    extractInfo(lines, definition, config.info[definition.id], config.info),
  ]));
  return { fields, info, meterNumber };
}

function inferMeterNumber(lines) {
  const counts = new Map();
  for (const [index, line] of lines.entries()) {
    const candidate = String(line).trim().split(/\s+/)[0];
    if (!/^\d{5,30}$/.test(candidate) || !parseMeasurementLine(line, candidate, index)) continue;
    counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  return ranked.length && ranked[0][1] >= 2 && ranked[0][1] > (ranked[1]?.[1] ?? 0) ? ranked[0][0] : "";
}
