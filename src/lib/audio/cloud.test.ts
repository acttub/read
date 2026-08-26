import { describe, expect, it } from "vitest";
import {
  CLOUD_VOICE_IDS,
  assignCloudVoiceIds,
  planCloudRequests,
  selectCloudAudio,
  type CloudLine,
} from "./cloud";

describe("assignCloudVoiceIds", () => {
  it("배역마다 서로 다른 허용 voiceId를 등장 순서대로 배정한다", () => {
    const assigned = assignCloudVoiceIds(["윤서", "태오", "민재"]);
    expect(Object.values(assigned)).toEqual(CLOUD_VOICE_IDS.slice(0, 3));
    expect(new Set(Object.values(assigned))).toHaveLength(3);
  });

  it("같은 배역 목록은 늘 같은 결과이고 voiceId 수를 넘으면 순환한다", () => {
    const roles = Array.from({ length: CLOUD_VOICE_IDS.length + 2 }, (_, index) => `역${index}`);
    expect(assignCloudVoiceIds(roles)).toEqual(assignCloudVoiceIds(roles));
    expect(assignCloudVoiceIds(roles)[`역${CLOUD_VOICE_IDS.length}`]).toBe(CLOUD_VOICE_IDS[0]);
  });
});

describe("selectCloudAudio", () => {
  const lines: CloudLine[] = [
    { lineId: 3, text: "같은 대사", voiceId: CLOUD_VOICE_IDS[0] },
    { lineId: 8, text: "둘째 줄", voiceId: CLOUD_VOICE_IDS[0] },
    { lineId: 12, text: "같은 대사", voiceId: CLOUD_VOICE_IDS[0] },
  ];

  it("일부 줄만 실패하면 성공한 줄의 위치를 보존한다", () => {
    expect(selectCloudAudio(lines, ["audio-1", null, "audio-3"])).toEqual([
      { line: lines[0], base64Audio: "audio-1" },
      { line: lines[2], base64Audio: "audio-3" },
    ]);
  });

  it("잘못되거나 짧은 응답은 없는 줄을 성공으로 만들지 않는다", () => {
    expect(selectCloudAudio(lines, ["audio-1"])).toEqual([{ line: lines[0], base64Audio: "audio-1" }]);
    expect(selectCloudAudio(lines, { audio: [] })).toEqual([]);
  });
});

describe("planCloudRequests", () => {
  it("voiceId가 다른 배역을 같은 요청에 섞지 않는다", () => {
    const requests = planCloudRequests([
      { lineId: 1, text: "하나", voiceId: CLOUD_VOICE_IDS[0] },
      { lineId: 2, text: "둘", voiceId: CLOUD_VOICE_IDS[1] },
      { lineId: 3, text: "셋", voiceId: CLOUD_VOICE_IDS[0] },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests.every((batch) => new Set(batch.map((line) => line.voiceId)).size === 1)).toBe(true);
  });
});
