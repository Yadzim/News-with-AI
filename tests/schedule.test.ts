import "./setup.js";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHourMinute } from "../src/schedule.js";

describe("parseHourMinute", () => {
  it("to‘g‘ri vaqtni o‘qiydi", () => {
    assert.deepEqual(parseHourMinute("08:00"), { hour: 8, minute: 0 });
    assert.deepEqual(parseHourMinute("23:59"), { hour: 23, minute: 59 });
    assert.deepEqual(parseHourMinute("7:05"), { hour: 7, minute: 5 });
    assert.deepEqual(parseHourMinute("  09:30  "), { hour: 9, minute: 30 });
  });

  it("chegaradan chiqqan vaqtni rad etadi", () => {
    assert.equal(parseHourMinute("24:00"), null);
    assert.equal(parseHourMinute("12:60"), null);
    assert.equal(parseHourMinute("-1:00"), null);
  });

  it("noto‘g‘ri formatni rad etadi", () => {
    for (const bad of ["", "8", "08:0", "08-00", "salom", "08:00:00"]) {
      assert.equal(parseHourMinute(bad), null, `rad etilishi kerak edi: ${bad}`);
    }
  });
});
