export const MODEL_TYPES = [
  "languageModel",
  "embeddingModel",
  "imageModel",
  "transcriptionModel",
  "speechModel",
  "rerankingModel",
  "videoModel",
] as const;

export type ModelType = (typeof MODEL_TYPES)[number];
