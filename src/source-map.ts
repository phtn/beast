import remapping, { type SourceMap, type SourceMapInput } from "@jridgewell/remapping";

/** A version 3 source map emitted by the Beast compiler. */
export interface BeastSourceMap {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: readonly (string | null)[];
  sourcesContent?: readonly (string | null)[];
  names: readonly string[];
  mappings: string;
  ignoreList?: readonly number[];
}

interface SourceMapShape {
  version: 3;
  file: string | null | undefined;
  sourceRoot: string | undefined;
  sources: readonly (string | null)[];
  sourcesContent: readonly (string | null)[] | undefined;
  names: readonly string[];
  mappings: unknown;
  ignoreList: readonly number[] | undefined;
}

/** Compose an output transform map through one or more input transform maps. */
export function composeSourceMaps(
  outputMap: unknown,
  ...inputMaps: readonly unknown[]
): BeastSourceMap | null {
  if (!isSourceMap(outputMap)) return null;

  const maps: SourceMapInput[] = [outputMap];
  for (const inputMap of inputMaps) {
    if (isSourceMap(inputMap)) maps.push(inputMap);
  }
  if (maps.length === 1) return sourceMapFrom(outputMap);
  return sourceMapFrom(remapping(maps, () => null));
}

function isSourceMap(value: unknown): value is SourceMapInput & SourceMapShape {
  if (typeof value !== "object" || value === null) return false;
  const map = value as Partial<BeastSourceMap>;
  return (
    map.version === 3 &&
    Array.isArray(map.sources) &&
    Array.isArray(map.names) &&
    typeof map.mappings === "string"
  );
}

function sourceMapFrom(map: SourceMapShape | SourceMap): BeastSourceMap {
  if (typeof map.mappings !== "string") {
    throw new TypeError("Expected an encoded version 3 source map.");
  }
  return {
    version: 3,
    ...(map.file === undefined || map.file === null ? {} : { file: map.file }),
    ...(map.sourceRoot === undefined ? {} : { sourceRoot: map.sourceRoot }),
    sources: [...map.sources],
    ...(map.sourcesContent === undefined
      ? {}
      : { sourcesContent: [...map.sourcesContent] }),
    names: [...map.names],
    mappings: map.mappings,
    ...(map.ignoreList === undefined ? {} : { ignoreList: [...map.ignoreList] }),
  };
}
