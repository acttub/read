import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  clearStartIndex,
  hasStartIndex,
  readStartIndex,
  saveScript,
  saveStartIndex,
} from "../app/storage.js";

const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "sessionStorage",
);
let values;

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem(key) {
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
    },
  });
});

afterEach(() => {
  if (originalStorage) {
    Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("시작 지점을 read.startIndex에 저장하고 첫 대사 선택과 미지정을 구분한다", () => {
  assert.equal(readStartIndex(20), 0);
  assert.equal(hasStartIndex(20), false);

  saveStartIndex(0);
  assert.equal(values.get("read.startIndex"), "0");
  assert.equal(readStartIndex(20), 0);
  assert.equal(hasStartIndex(20), true);

  saveStartIndex(12);
  assert.equal(readStartIndex(20), 12);
  assert.equal(hasStartIndex(20), true);

  clearStartIndex();
  assert.equal(readStartIndex(20), 0);
  assert.equal(hasStartIndex(20), false);
});

test("비정수와 범위 밖 시작 지점은 0으로 읽는다", () => {
  for (const invalid of ["-1", "1.5", "20", "NaN", "Infinity", ""]) {
    values.set("read.startIndex", invalid);
    assert.equal(readStartIndex(20), 0, `${invalid} should fall back to 0`);
    assert.equal(hasStartIndex(20), false);
  }

  saveStartIndex(1.5);
  assert.equal(values.get("read.startIndex"), "0");
  assert.equal(readStartIndex(20), 0);
});

test("새 대본을 저장하면 이전 시작 지점을 초기화한다", () => {
  saveStartIndex(8);
  saveScript("가: 새 대본");

  assert.equal(values.get("read.script"), "가: 새 대본");
  assert.equal(values.get("read.startIndex"), "");
  assert.equal(hasStartIndex(10), false);
  assert.equal(readStartIndex(10), 0);
});
