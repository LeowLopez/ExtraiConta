import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultConfig,
  extractInvoice,
  extractNumberCandidates,
  normalizeText,
  parseMeasurementLine,
  parseLocalizedNumber,
  validateConfig,
} from "../src/extraction.js";

const TEST_METER_NUMBER = "12345678";

test("normalizes case, accents, and repeated whitespace", () => {
  assert.equal(normalizeText("  Emissão   da Fatura "), "EMISSAO DA FATURA");
});

test("parses Brazilian decimal and thousands separators", () => {
  assert.equal(parseLocalizedNumber("1.234,567"), 1234.567);
  assert.equal(parseLocalizedNumber("123,45"), 123.45);
  assert.equal(parseLocalizedNumber("1.234"), 1234);
});

test("parses Enel measurement rows after the meter, measure, post, and three register values", () => {
  const line = `${TEST_METER_NUMBER} ENRG ATV F PONTA INDU 10 20 1 345,600`;
  assert.deepEqual(parseMeasurementLine(line, TEST_METER_NUMBER), {
    measure: "ENRG ATV",
    post: "F PONTA INDU",
    value: 345.6,
    sourceLine: line,
    index: 0,
  });
  assert.equal(parseMeasurementLine("99999999 ENRG ATV F PONTA INDU 10 20 1 345,600", TEST_METER_NUMBER), null);
  assert.equal(parseMeasurementLine(`${TEST_METER_NUMBER} ENRG ATV F PONTA INDU 10 20 1`, TEST_METER_NUMBER), null);
});

test("reads contracted demand values from the invoice", () => {
  const config = createDefaultConfig();
  const data = extractInvoice([
    "Demanda contratada Ponta: 360 kW",
    "Demanda contratada Fora de Ponta: 420 kW",
  ], config);
  assert.equal(data.fields.demanda_contratada_ponta.value, 360);
  assert.equal(data.fields.demanda_contratada_ponta.status, "review");
  assert.equal(data.fields.demanda_contratada_fora_ponta.value, 420);
  assert.equal(data.fields.demanda_contratada_fora_ponta.status, "review");
});

test("filters by meter and matches each measurement using its measure and post", () => {
  const config = createDefaultConfig();
  const data = extractInvoice([
    `${TEST_METER_NUMBER} ENRG ATV F PONTA INDU 1 2 1 120,000`,
    `${TEST_METER_NUMBER} ENRG ATV F PONTA 1 2 1 30,000`,
    `${TEST_METER_NUMBER} ENRG ATV PONTA 1 2 1 45,000`,
    "99999999 ENRG ATV PONTA 1 2 1 900,000",
    `${TEST_METER_NUMBER} DEMANDA F PONTA INDU 1 2 1 125,000`,
    `${TEST_METER_NUMBER} DEMANDA F PONTA CAP 1 2 1 130,000`,
    `${TEST_METER_NUMBER} DEMANDA CONTRATADA FORA PONTA 1 2 1 350,000`,
    `${TEST_METER_NUMBER} DEMANDA CONTRATADA PONTA 1 2 1 360,000`,
    `${TEST_METER_NUMBER} ENRG RTV F PONTA INDU 1 2 1 140,000`,
    `${TEST_METER_NUMBER} ENRG RTV PONTA 1 2 1 150,000`,
    "Data de emissão: 01/10/2026",
    "Vencimento 15/10/2026",
    "Bandeira tarifária: Verde",
    "Valor total da fatura R$ 1.234,56",
  ], config);
  assert.equal(data.fields.consumo_fora_ponta.value, 150);
  assert.equal(data.fields.consumo_na_ponta.value, 45);
  assert.equal(data.fields.demanda_faturada_fora_ponta.value, 125);
  assert.equal(data.fields.demanda_faturada_ponta.value, 130);
  assert.equal(data.fields.demanda_contratada_fora_ponta.value, 350);
  assert.equal(data.fields.demanda_contratada_ponta.value, 360);
  assert.equal(data.fields.energia_reativa_fora_ponta.value, 140);
  assert.equal(data.fields.energia_reativa_ponta.value, 150);
  assert.equal(data.fields.valor_bruto.value, 1234.56);
  assert.equal(data.meterNumber, TEST_METER_NUMBER);
  assert.equal(data.info.issueDate.value, "01/10/2026");
  assert.equal(data.info.dueDate.value, "15/10/2026");
  assert.equal(data.info.tariffFlag.value, "Verde");
});

test("reads gross value from the line below its label and supports custom aliases", () => {
  const config = createDefaultConfig();
  config.grossValueAliases = ["TOTAL A PAGAR"];
  const data = extractInvoice([
    "TOTAL A PAGAR",
    "Vencimento 20/10/2026 Referência 10/2026 R$ 987,65",
  ], config);
  assert.equal(data.fields.valor_bruto.value, 987.65);
});

test("matches dates to labels when the invoice places values on the next line", () => {
  const data = extractInvoice([
    "DATA DE EMISSÃO: NOTA FISCAL: REFERÊNCIA: DATA DE VENCIMENTO: VALOR DO DOCUMENTO:",
    "05/09/2026 123 09/2026 20/09/2026 R$ 1.234,56",
  ], createDefaultConfig());
  assert.equal(data.info.issueDate.value, "05/09/2026");
  assert.equal(data.info.dueDate.value, "20/09/2026");
  assert.equal(data.fields.valor_bruto.value, 1234.56);
});

test("extracts user-defined fields from the number immediately after their configured text", () => {
  const config = createDefaultConfig();
  config.customFields = [{ id: "energia-total", label: "Energia total", prefix: "Energia faturada:" }];
  const data = extractInvoice(["Energia faturada: R$ 42,75"], config);
  assert.equal(data.fields["custom_energia-total"].value, 42.75);
  assert.equal(data.fields["custom_energia-total"].label, "Energia total");
});

test("does not mistake an additional tariff charge for the applied tariff flag", () => {
  const data = extractInvoice([
    "ADICIONAL BANDEIRA AMARELA FP",
  ], createDefaultConfig());
  assert.equal(data.info.tariffFlag.value, "");
  assert.equal(data.info.tariffFlag.status, "missing");
});

test("extracts the tariff flag instead of retaining its explanatory text or markdown", () => {
  const data = extractInvoice([
    "Bandeira tarifária**(s) tarifária(s) aplicada(s) no mês: AMARELA**",
  ], createDefaultConfig());
  assert.equal(data.info.tariffFlag.value, "Amarela");
});

test("migrates saved version 1 rules without keeping unreliable numeric positions", () => {
  const legacy = createDefaultConfig();
  legacy.version = 1;
  legacy.fields = Object.fromEntries([
    "consumo_fora_ponta",
    "consumo_na_ponta",
    "demanda_contratada_ponta",
    "demanda_contratada_fora_ponta",
    "demanda_faturada_fora_ponta",
    "demanda_faturada_ponta",
    "energia_reativa_fora_ponta",
    "energia_reativa_ponta",
    "valor_bruto",
  ].map((id) => [id, { aliases: ["IGNORADO"], operation: "first", valueIndex: 0, fixedValue: "" }]));
  legacy.fields.demanda_contratada_ponta.fixedValue = "420";
  const migrated = validateConfig(legacy);
  assert.equal(migrated.version, 4);
  assert.equal("fixedValues" in migrated, false);
  assert.equal(migrated.meterNumber, "");
});

test("migrates version 3 preferences and keeps their meter setting", () => {
  const legacy = createDefaultConfig();
  legacy.version = 3;
  legacy.meterNumber = TEST_METER_NUMBER;
  const migrated = validateConfig(legacy);
  assert.equal(migrated.version, 4);
  assert.equal(migrated.meterNumber, TEST_METER_NUMBER);
  assert.deepEqual(migrated.customFields, []);
});

test("identifies a unique meter from repeated measurement rows and asks for manual configuration on ambiguity", () => {
  const lines = [
    `${TEST_METER_NUMBER} ENRG ATV F PONTA INDU 1 2 1 120,000`,
    `${TEST_METER_NUMBER} ENRG ATV PONTA 1 2 1 45,000`,
  ];
  assert.equal(extractInvoice(lines, createDefaultConfig()).meterNumber, TEST_METER_NUMBER);
  assert.equal(extractInvoice([
    `${TEST_METER_NUMBER} ENRG ATV F PONTA INDU 1 2 1 120,000`,
    "87654321 ENRG ATV F PONTA INDU 1 2 1 90,000",
  ], createDefaultConfig()).meterNumber, "");
});

test("rejects malformed imported configuration", () => {
  assert.throws(() => validateConfig({ version: 1, fields: {}, info: {} }), /Regra inválida/);
});

test("extracts localized numeric candidates in order", () => {
  assert.deepEqual(extractNumberCandidates("1.000,00 25,5 12"), [1000, 25.5, 12]);
});
