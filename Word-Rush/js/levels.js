import { LEVEL_CONFIG } from "./levels.config.js";

function stringSetting(value, name, index) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`Level config #${index + 1} is missing ${name}`);
  }
  return text;
}

function numberSetting(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeLevel(config, index) {
  const order = numberSetting(config.order, index + 1);
  return {
    order,
    id: stringSetting(config.id, "id", index),
    label: stringSetting(config.label, "label", index),
    file: stringSetting(config.csvFile || config.file, "csvFile", index),
    baseSpeed: numberSetting(config.baseSpeed, 40 + index * 2),
    accel: numberSetting(config.accel, 0.66 + index * 0.04),
    bonus: numberSetting(config.bonus, 0)
  };
}

export const LEVELS = LEVEL_CONFIG
  .map((config, index) => ({ ...normalizeLevel(config, index), sourceIndex: index }))
  .sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex)
  .map(({ sourceIndex, ...level }) => level);

export const LEVEL_MAP = new Map();

for (const level of LEVELS) {
  if (LEVEL_MAP.has(level.id)) {
    throw new Error(`Duplicate level id: ${level.id}`);
  }
  LEVEL_MAP.set(level.id, level);
}
