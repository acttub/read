import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import {
  MAX_SCRIPT_FILE_BYTES,
  decodeTextBuffer,
  decompressZipEntry,
  getFileExtension,
  getZipEntryCompressedData,
  parseZipCentralDirectory,
  readScriptFile,
  routeScriptFile,
} from "../app/scriptfile.js";
import { parseScript } from "../app/parse.js";

function makeZip(entryName, contents, compressionMethod = 0) {
  const nameBytes = new TextEncoder().encode(entryName);
  const contentBytes =
    typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
  const compressedBytes =
    compressionMethod === 8 ? deflateRawSync(contentBytes) : contentBytes;
  const localLength = 30 + nameBytes.length + compressedBytes.length;
  const centralLength = 46 + nameBytes.length;
  const output = new Uint8Array(localLength + centralLength + 22);
  const view = new DataView(output.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, compressionMethod, true);
  view.setUint32(18, compressedBytes.length, true);
  view.setUint32(22, contentBytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  output.set(nameBytes, 30);
  output.set(compressedBytes, 30 + nameBytes.length);

  const centralOffset = localLength;
  view.setUint32(centralOffset, 0x02014b50, true);
  view.setUint16(centralOffset + 4, 20, true);
  view.setUint16(centralOffset + 6, 20, true);
  view.setUint16(centralOffset + 8, 0x0800, true);
  view.setUint16(centralOffset + 10, compressionMethod, true);
  view.setUint32(centralOffset + 20, compressedBytes.length, true);
  view.setUint32(centralOffset + 24, contentBytes.length, true);
  view.setUint16(centralOffset + 28, nameBytes.length, true);
  view.setUint32(centralOffset + 42, 0, true);
  output.set(nameBytes, centralOffset + 46);

  const eocdOffset = centralOffset + centralLength;
  view.setUint32(eocdOffset, 0x06054b50, true);
  view.setUint16(eocdOffset + 8, 1, true);
  view.setUint16(eocdOffset + 10, 1, true);
  view.setUint32(eocdOffset + 12, centralLength, true);
  view.setUint32(eocdOffset + 16, centralOffset, true);
  return output.buffer;
}

test("확장자를 대소문자와 무관하게 찾는다", () => {
  assert.equal(getFileExtension("대본.TXT"), ".txt");
  assert.equal(getFileExtension("이름"), "");
});

test("지원 형식, 안내 형식, 5MB 상한을 구분한다", () => {
  assert.deepEqual(routeScriptFile({ name: "대본.txt", size: 10 }), {
    kind: "parse",
    format: "txt",
  });
  assert.equal(routeScriptFile({ name: "대본.hwp", size: 10 }).kind, "guidance");
  assert.equal(routeScriptFile({ name: "대본.pdf", size: 10 }).kind, "guidance");
  assert.equal(
    routeScriptFile({ name: "대본.txt", size: MAX_SCRIPT_FILE_BYTES + 1 }).code,
    "file_too_large",
  );
  assert.equal(routeScriptFile({ name: "대본.rtf", size: 10 }).code, "unsupported_format");
});

test("UTF-8 TXT를 그대로 디코드한다", () => {
  const source = new TextEncoder().encode(
    "지훈: 왜 아무 말도 안 했어.\n서연: 말하면 네가 그만둘 것 같았으니까.",
  );
  const result = decodeTextBuffer(source);
  assert.match(result.text, /^지훈:/);
  assert.equal(result.encoding, "utf-8");
  assert.equal(result.warning, "");
  assert.deepEqual(parseScript(result.text).roles, ["지훈", "서연"]);
});

test("CP949(EUC-KR) TXT를 한글로 디코드한다", () => {
  const source = Uint8Array.from([0xb0, 0xa1, 0x3a, 0x20, 0xb3, 0xaa]);
  const result = decodeTextBuffer(source);
  assert.equal(result.text, "가: 나");
  assert.equal(result.encoding, "cp949");
  assert.equal(result.warning, "");
  assert.deepEqual(parseScript(result.text).roles, ["가"]);
});

test("UTF-8과 CP949 모두 깨지는 바이트에는 재저장 안내를 붙인다", () => {
  const result = decodeTextBuffer(Uint8Array.from([0xff]));
  assert.equal(result.encoding, "utf-8-fallback");
  assert.match(result.text, /\uFFFD/);
  assert.match(result.warning, /UTF-8/);
});

test("실제 ArrayBuffer에서 ZIP 중앙 디렉터리와 stored 항목을 읽는다", async () => {
  const archive = makeZip("word/document.xml", "<document>본문</document>");
  const entries = parseZipCentralDirectory(archive);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "word/document.xml");
  assert.equal(entries[0].compressionMethod, 0);
  assert.equal(
    new TextDecoder().decode(getZipEntryCompressedData(archive, entries[0])),
    "<document>본문</document>",
  );
  assert.equal(
    new TextDecoder().decode(await decompressZipEntry(archive, entries[0])),
    "<document>본문</document>",
  );
});

test("실제 deflate-raw ZIP 항목을 DecompressionStream으로 푼다", async () => {
  const archive = makeZip(
    "Contents/section0.xml",
    "<section><p><t>압축된 본문</t></p></section>",
    8,
  );
  const [entry] = parseZipCentralDirectory(archive);

  assert.equal(entry.compressionMethod, 8);
  assert.equal(
    new TextDecoder().decode(await decompressZipEntry(archive, entry)),
    "<section><p><t>압축된 본문</t></p></section>",
  );
});

test("TXT 파일 읽기 결과를 반환하고 빈 파일은 거부한다", async () => {
  const bytes = new TextEncoder().encode("서연: 말하면 네가 그만둘 것 같았으니까.");
  const result = await readScriptFile({
    name: "대본.txt",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  });
  assert.equal(result.kind, "success");
  assert.match(result.text, /^서연:/);

  await assert.rejects(
    readScriptFile({
      name: "빈.txt",
      size: 0,
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
    (error) => error.code === "empty_text",
  );
});

test("HWP/PDF 안내와 5MB 거부는 파일 본문을 읽지 않는다", async () => {
  let readCount = 0;
  const arrayBuffer = async () => {
    readCount += 1;
    return new ArrayBuffer(0);
  };

  const hwp = await readScriptFile({ name: "대본.hwp", size: 10, arrayBuffer });
  const pdf = await readScriptFile({ name: "대본.pdf", size: 10, arrayBuffer });
  const tooLarge = await readScriptFile({
    name: "대본.txt",
    size: MAX_SCRIPT_FILE_BYTES + 1,
    arrayBuffer,
  });

  assert.match(hwp.message, /HWPX.*TXT/);
  assert.match(pdf.message, /복사해 붙여넣거나 TXT/);
  assert.equal(tooLarge.code, "file_too_large");
  assert.equal(readCount, 0);
});
