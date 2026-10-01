import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";

const MODEL_DIR_NAME = "sherpa-kws-en";

const MODEL_ASSETS = {
  encoder: require("../../assets/wakeword/sherpa-kws-en/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx"),
  decoder: require("../../assets/wakeword/sherpa-kws-en/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx"),
  joiner: require("../../assets/wakeword/sherpa-kws-en/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx"),
  tokens: require("../../assets/wakeword/sherpa-kws-en/tokens.txt"),
  keywords: require("../../assets/wakeword/sherpa-kws-en/keywords.txt"),
} as const;

export type PreparedKwsModels = {
  modelDir: string;
  modelFiles: {
    encoder: string;
    decoder: string;
    joiner: string;
    tokens: string;
  };
  keywordsFile: string;
};

const MODEL_BUNDLE_VERSION = "7a-2";

async function copyAssetToDir(
  moduleId: number,
  destDir: string,
  fileName: string,
  force = false,
): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  if (!asset.localUri) {
    throw new Error(`Failed to resolve asset: ${fileName}`);
  }
  const dest = `${destDir}${fileName}`;
  const info = await FileSystem.getInfoAsync(dest);
  if (force && info.exists) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  }
  if (!info.exists || force) {
    await FileSystem.copyAsync({ from: asset.localUri, to: dest });
  }
  return dest;
}

/**
 * Copy bundled KWS models into a real filesystem directory.
 * Sherpa/Android need absolute file paths (not asset:// URIs).
 */
export async function ensureKwsModelsOnDisk(): Promise<PreparedKwsModels> {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new Error("documentDirectory is unavailable");
  }
  const modelDir = `${base}${MODEL_DIR_NAME}/`;
  await FileSystem.makeDirectoryAsync(modelDir, { intermediates: true });

  const versionPath = `${modelDir}.bundle_version`;
  const versionInfo = await FileSystem.getInfoAsync(versionPath);
  let forceRefresh = true;
  if (versionInfo.exists) {
    const current = await FileSystem.readAsStringAsync(versionPath);
    forceRefresh = current.trim() !== MODEL_BUNDLE_VERSION;
  }

  const encoderName = "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx";
  const decoderName = "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx";
  const joinerName = "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx";
  const tokensName = "tokens.txt";
  const keywordsName = "keywords.txt";

  await copyAssetToDir(MODEL_ASSETS.encoder, modelDir, encoderName, forceRefresh);
  await copyAssetToDir(MODEL_ASSETS.decoder, modelDir, decoderName, forceRefresh);
  await copyAssetToDir(MODEL_ASSETS.joiner, modelDir, joinerName, forceRefresh);
  await copyAssetToDir(MODEL_ASSETS.tokens, modelDir, tokensName, forceRefresh);
  // Always refresh keywords — small file, encoding-sensitive.
  await copyAssetToDir(MODEL_ASSETS.keywords, modelDir, keywordsName, true);
  await FileSystem.writeAsStringAsync(versionPath, MODEL_BUNDLE_VERSION);

  return {
    modelDir,
    modelFiles: {
      encoder: encoderName,
      decoder: decoderName,
      joiner: joinerName,
      tokens: tokensName,
    },
    keywordsFile: keywordsName,
  };
}
