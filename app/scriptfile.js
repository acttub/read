export const MAX_SCRIPT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_EXTRACTED_XML_BYTES = 20 * 1024 * 1024;

const ZIP_SIGNATURE = Object.freeze({
  localFileHeader: 0x04034b50,
  centralDirectory: 0x02014b50,
  endOfCentralDirectory: 0x06054b50,
});

const GUIDANCE = Object.freeze({
  hwp: "한글에서 ‘다른 이름으로 저장’ → ‘HWPX’ 또는 ‘TXT’로 저장해 올려주세요.",
  pdf: "PDF는 아직 못 읽어요. 텍스트를 복사해 붙여넣거나 TXT로 저장해 올려주세요.",
});

export class ScriptFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ScriptFileError";
    this.code = code;
  }
}

function asBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  throw new TypeError("ArrayBuffer 또는 ArrayBufferView가 필요합니다.");
}

function readUint16(view, offset, limit, context) {
  if (offset < 0 || offset + 2 > limit) {
    throw new ScriptFileError("corrupt_zip", `${context} 범위가 올바르지 않습니다.`);
  }
  return view.getUint16(offset, true);
}

function readUint32(view, offset, limit, context) {
  if (offset < 0 || offset + 4 > limit) {
    throw new ScriptFileError("corrupt_zip", `${context} 범위가 올바르지 않습니다.`);
  }
  return view.getUint32(offset, true);
}

function decodeZipEntryName(bytes, utf8) {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);

  // 이번에 찾는 경로(word/document.xml, Contents/section*.xml)는 모두 ASCII다.
  // ZIP의 비 UTF-8 파일명 문자셋(CP437)을 억지로 해석하지 않아도 목표 파일은 정확히 찾을 수 있다.
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

export function getFileExtension(fileName) {
  const normalized = String(fileName ?? "").trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex === -1 ? "" : normalized.slice(dotIndex);
}

export function routeScriptFile(fileLike) {
  const size = Number(fileLike?.size);
  if (!Number.isFinite(size) || size < 0) {
    return {
      kind: "error",
      code: "invalid_file",
      message: "파일 정보를 읽지 못했어요. 다른 파일을 골라주세요.",
    };
  }

  if (size > MAX_SCRIPT_FILE_BYTES) {
    return {
      kind: "error",
      code: "file_too_large",
      message: "파일은 5MB 이하만 열 수 있어요.",
    };
  }

  const extension = getFileExtension(fileLike?.name);
  if (extension === ".txt") return { kind: "parse", format: "txt" };
  if (extension === ".docx") return { kind: "parse", format: "docx" };
  if (extension === ".hwpx") return { kind: "parse", format: "hwpx" };
  if (extension === ".hwp") {
    return { kind: "guidance", format: "hwp", message: GUIDANCE.hwp };
  }
  if (extension === ".pdf") {
    return { kind: "guidance", format: "pdf", message: GUIDANCE.pdf };
  }

  return {
    kind: "error",
    code: "unsupported_format",
    message: "TXT, DOCX, HWPX 파일을 열 수 있어요.",
  };
}

export function decodeTextBuffer(source) {
  const bytes = asBytes(source);
  const utf8Fallback = new TextDecoder("utf-8").decode(bytes);

  try {
    const utf8Text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!utf8Text.includes("\uFFFD")) {
      return { text: utf8Text, encoding: "utf-8", warning: "" };
    }
  } catch {
    // UTF-8이 아니면 한국어 TXT에서 흔한 CP949로 다시 읽는다.
  }

  try {
    const cp949Text = new TextDecoder("euc-kr").decode(bytes);
    if (!cp949Text.includes("\uFFFD")) {
      return { text: cp949Text, encoding: "cp949", warning: "" };
    }
  } catch {
    // 드문 구형 브라우저에서 euc-kr 디코더를 제공하지 않으면 UTF-8 결과와 안내를 쓴다.
  }

  return {
    text: utf8Fallback,
    encoding: "utf-8-fallback",
    warning: "글자가 깨져 보이면 파일을 UTF-8로 저장해 다시 올려주세요.",
  };
}

export function parseZipCentralDirectory(source) {
  const bytes = asBytes(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEocdOffset = Math.max(0, bytes.byteLength - 22 - 0xffff);
  let eocdOffset = -1;

  for (let offset = bytes.byteLength - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_SIGNATURE.endOfCentralDirectory) continue;
    const commentLength = readUint16(
      view,
      offset + 20,
      bytes.byteLength,
      "ZIP 끝 레코드",
    );
    if (offset + 22 + commentLength === bytes.byteLength) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new ScriptFileError("corrupt_zip", "ZIP 중앙 디렉터리를 찾지 못했습니다.");
  }

  const diskNumber = readUint16(view, eocdOffset + 4, bytes.byteLength, "ZIP 디스크");
  const centralDisk = readUint16(view, eocdOffset + 6, bytes.byteLength, "ZIP 디스크");
  const entriesOnDisk = readUint16(view, eocdOffset + 8, bytes.byteLength, "ZIP 항목 수");
  const entryCount = readUint16(view, eocdOffset + 10, bytes.byteLength, "ZIP 항목 수");
  const centralSize = readUint32(view, eocdOffset + 12, bytes.byteLength, "ZIP 중앙 디렉터리");
  const centralOffset = readUint32(view, eocdOffset + 16, bytes.byteLength, "ZIP 중앙 디렉터리");

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new ScriptFileError("unsupported_zip", "분할 ZIP 파일은 읽을 수 없습니다.");
  }
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new ScriptFileError("unsupported_zip", "ZIP64 파일은 읽을 수 없습니다.");
  }

  const centralEnd = centralOffset + centralSize;
  if (centralOffset < 0 || centralEnd > eocdOffset || centralEnd > bytes.byteLength) {
    throw new ScriptFileError("corrupt_zip", "ZIP 중앙 디렉터리 범위가 올바르지 않습니다.");
  }

  const entries = [];
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > centralEnd ||
      readUint32(view, cursor, centralEnd, "ZIP 항목") !== ZIP_SIGNATURE.centralDirectory
    ) {
      throw new ScriptFileError("corrupt_zip", "ZIP 항목 정보가 올바르지 않습니다.");
    }

    const flags = readUint16(view, cursor + 8, centralEnd, "ZIP 항목");
    const compressionMethod = readUint16(view, cursor + 10, centralEnd, "ZIP 항목");
    const compressedSize = readUint32(view, cursor + 20, centralEnd, "ZIP 항목");
    const uncompressedSize = readUint32(view, cursor + 24, centralEnd, "ZIP 항목");
    const fileNameLength = readUint16(view, cursor + 28, centralEnd, "ZIP 파일명");
    const extraLength = readUint16(view, cursor + 30, centralEnd, "ZIP 추가 정보");
    const commentLength = readUint16(view, cursor + 32, centralEnd, "ZIP 주석");
    const localHeaderOffset = readUint32(view, cursor + 42, centralEnd, "ZIP 로컬 헤더");
    const nextCursor = cursor + 46 + fileNameLength + extraLength + commentLength;

    if (nextCursor > centralEnd) {
      throw new ScriptFileError("corrupt_zip", "ZIP 항목 길이가 올바르지 않습니다.");
    }

    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + fileNameLength);
    entries.push({
      name: decodeZipEntryName(nameBytes, Boolean(flags & 0x0800)),
      flags,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    cursor = nextCursor;
  }

  if (cursor !== centralEnd) {
    throw new ScriptFileError("corrupt_zip", "ZIP 중앙 디렉터리 크기가 맞지 않습니다.");
  }

  return entries;
}

export function getZipEntryCompressedData(source, entry) {
  const bytes = asBytes(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = Number(entry?.localHeaderOffset);

  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset + 30 > bytes.byteLength ||
    readUint32(view, offset, bytes.byteLength, "ZIP 로컬 헤더") !==
      ZIP_SIGNATURE.localFileHeader
  ) {
    throw new ScriptFileError("corrupt_zip", "ZIP 로컬 헤더가 올바르지 않습니다.");
  }
  if (entry.flags & 0x0001) {
    throw new ScriptFileError("unsupported_zip", "암호로 보호된 파일은 읽을 수 없습니다.");
  }

  const fileNameLength = readUint16(
    view,
    offset + 26,
    bytes.byteLength,
    "ZIP 로컬 파일명",
  );
  const extraLength = readUint16(
    view,
    offset + 28,
    bytes.byteLength,
    "ZIP 로컬 추가 정보",
  );
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;

  if (dataOffset < 0 || dataEnd > bytes.byteLength) {
    throw new ScriptFileError("corrupt_zip", "ZIP 압축 데이터 범위가 올바르지 않습니다.");
  }

  return bytes.slice(dataOffset, dataEnd);
}

async function collectDecompressedBytes(stream, expectedSize) {
  const reader = stream.getReader();
  const chunks = [];
  let totalSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.byteLength;
      if (totalSize > MAX_EXTRACTED_XML_BYTES) {
        throw new ScriptFileError(
          "expanded_file_too_large",
          "압축을 푼 문서가 너무 커서 읽을 수 없습니다.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  }

  if (totalSize !== expectedSize) {
    throw new ScriptFileError("corrupt_zip", "압축을 푼 파일 크기가 맞지 않습니다.");
  }

  const output = new Uint8Array(totalSize);
  let outputOffset = 0;
  for (const chunk of chunks) {
    output.set(chunk, outputOffset);
    outputOffset += chunk.byteLength;
  }
  return output;
}

export async function decompressZipEntry(
  source,
  entry,
  DecompressionStreamClass = globalThis.DecompressionStream,
) {
  if (entry.uncompressedSize > MAX_EXTRACTED_XML_BYTES) {
    throw new ScriptFileError(
      "expanded_file_too_large",
      "압축을 푼 문서가 너무 커서 읽을 수 없습니다.",
    );
  }

  const compressedBytes = getZipEntryCompressedData(source, entry);

  if (entry.compressionMethod === 0) {
    if (compressedBytes.byteLength !== entry.uncompressedSize) {
      throw new ScriptFileError("corrupt_zip", "저장된 ZIP 항목 크기가 맞지 않습니다.");
    }
    return compressedBytes;
  }

  if (entry.compressionMethod !== 8) {
    throw new ScriptFileError("unsupported_zip", "지원하지 않는 ZIP 압축 방식입니다.");
  }
  if (typeof DecompressionStreamClass !== "function") {
    throw new ScriptFileError(
      "decompression_unavailable",
      "이 브라우저에서는 DOCX/HWPX 파일을 열 수 없어요. TXT로 저장해 올려주세요.",
    );
  }

  let decompressedStream;
  try {
    decompressedStream = new Blob([compressedBytes])
      .stream()
      .pipeThrough(new DecompressionStreamClass("deflate-raw"));
  } catch {
    throw new ScriptFileError(
      "decompression_unavailable",
      "이 브라우저에서는 DOCX/HWPX 파일을 열 수 없어요. TXT로 저장해 올려주세요.",
    );
  }

  try {
    return await collectDecompressedBytes(decompressedStream, entry.uncompressedSize);
  } catch (error) {
    if (error instanceof ScriptFileError) throw error;
    throw new ScriptFileError("decompression_failed", "압축된 문서를 풀지 못했습니다.");
  }
}

function elementLocalName(element) {
  return element.localName || element.nodeName.split(":").pop();
}

function extractParagraphContent(paragraph) {
  let text = "";

  for (const element of paragraph.getElementsByTagName("*")) {
    const localName = elementLocalName(element);
    if (localName === "t") text += element.textContent ?? "";
    if (localName === "tab") text += "\t";
    if (localName === "br" || localName === "cr" || localName === "lineBreak") {
      text += "\n";
    }
  }

  return text;
}

// DOMParser가 필요한 유일한 단계다. ZIP/인코딩 함수와 분리해 Node에서도 나머지를 시험한다.
export function extractScriptTextFromXml(
  xmlText,
  DOMParserClass = globalThis.DOMParser,
) {
  if (typeof DOMParserClass !== "function") {
    throw new ScriptFileError("dom_parser_unavailable", "XML 파서를 사용할 수 없습니다.");
  }

  const xmlDocument = new DOMParserClass().parseFromString(xmlText, "application/xml");
  if (
    xmlDocument.getElementsByTagName("parsererror").length > 0 ||
    xmlDocument.getElementsByTagNameNS("*", "parsererror").length > 0
  ) {
    throw new ScriptFileError("invalid_xml", "문서의 XML 구조가 올바르지 않습니다.");
  }

  const paragraphs = Array.from(xmlDocument.getElementsByTagName("*")).filter(
    (element) => elementLocalName(element) === "p",
  );
  return paragraphs.map(extractParagraphContent).join("\n").trim();
}

function decodeXmlBytes(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

async function extractDocxText(source, entries, dependencies) {
  const documentEntry = entries.find((entry) => entry.name === "word/document.xml");
  if (!documentEntry) {
    throw new ScriptFileError("missing_document_xml", "Word 문서 본문을 찾지 못했습니다.");
  }

  const xmlBytes = await decompressZipEntry(
    source,
    documentEntry,
    dependencies.DecompressionStreamClass,
  );
  return extractScriptTextFromXml(
    decodeXmlBytes(xmlBytes),
    dependencies.DOMParserClass,
  );
}

async function extractHwpxText(source, entries, dependencies) {
  const sectionEntries = entries
    .map((entry) => {
      const match = /^Contents\/section(\d+)\.xml$/.exec(entry.name);
      return match ? { entry, sectionNumber: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.sectionNumber - right.sectionNumber);

  if (sectionEntries.length === 0) {
    throw new ScriptFileError("missing_section_xml", "HWPX 문서 본문을 찾지 못했습니다.");
  }

  const sections = [];
  for (const { entry } of sectionEntries) {
    const xmlBytes = await decompressZipEntry(
      source,
      entry,
      dependencies.DecompressionStreamClass,
    );
    const sectionText = extractScriptTextFromXml(
      decodeXmlBytes(xmlBytes),
      dependencies.DOMParserClass,
    );
    if (sectionText) sections.push(sectionText);
  }
  return sections.join("\n");
}

function fileReadError(format) {
  const label = format === "docx" ? "DOCX" : format === "hwpx" ? "HWPX" : "TXT";
  return new ScriptFileError(
    "file_read_failed",
    `${label} 파일을 읽지 못했어요. 파일이 손상되지 않았는지 확인해 주세요.`,
  );
}

export async function readScriptFile(file, dependencies = {}) {
  const route = routeScriptFile(file);
  if (route.kind !== "parse") return route;

  let source;
  try {
    source = await file.arrayBuffer();
  } catch {
    throw fileReadError(route.format);
  }

  try {
    if (route.format === "txt") {
      const decoded = decodeTextBuffer(source);
      if (!decoded.text.trim()) {
        throw new ScriptFileError(
          "empty_text",
          "파일에서 읽을 수 있는 텍스트를 찾지 못했어요.",
        );
      }
      return { kind: "success", format: "txt", ...decoded };
    }

    const entries = parseZipCentralDirectory(source);
    const browserDependencies = {
      DecompressionStreamClass:
        dependencies.DecompressionStreamClass ?? globalThis.DecompressionStream,
      DOMParserClass: dependencies.DOMParserClass ?? globalThis.DOMParser,
    };
    const text =
      route.format === "docx"
        ? await extractDocxText(source, entries, browserDependencies)
        : await extractHwpxText(source, entries, browserDependencies);

    if (!text.trim()) {
      throw new ScriptFileError(
        "empty_text",
        "파일에서 읽을 수 있는 텍스트를 찾지 못했어요.",
      );
    }
    return { kind: "success", format: route.format, text, warning: "" };
  } catch (error) {
    if (
      error instanceof ScriptFileError &&
      [
        "empty_text",
        "expanded_file_too_large",
        "decompression_unavailable",
      ].includes(error.code)
    ) {
      throw error;
    }
    throw fileReadError(route.format);
  }
}
