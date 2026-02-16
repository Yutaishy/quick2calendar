import assert from "node:assert/strict";
import { parseDirectInput } from "../src/main/direct-parser.js";
import { parseFlexibleDateTime } from "../src/main/date-utils.js";

const fixedNow = new Date("2026-02-15T12:00:00");

assert.equal(
  parseFlexibleDateTime("2/20 19:00", fixedNow),
  "2026-02-20T19:00:00"
);
assert.equal(
  parseFlexibleDateTime("今日 9:00", fixedNow),
  "2026-02-15T09:00:00"
);
assert.equal(
  parseFlexibleDateTime("明日 18", fixedNow),
  "2026-02-16T18:00:00"
);
assert.equal(
  parseFlexibleDateTime("明日五時からご飯", fixedNow),
  "2026-02-16T05:00:00"
);
assert.equal(
  parseFlexibleDateTime("明日五時半", fixedNow),
  "2026-02-16T05:30:00"
);
assert.equal(parseFlexibleDateTime("2026-02-31 10:00", fixedNow), null);

const draft = parseDirectInput("明日 18:30 会食", 60, fixedNow);
assert.equal(draft.title, "会食");
assert.ok(draft.start, "start should be parsed");
assert.ok(draft.end, "end should be inferred");

const draftWithKanjiHour = parseDirectInput("明日五時からご飯", 60, fixedNow);
assert.equal(draftWithKanjiHour.title, "ご飯");
assert.equal(draftWithKanjiHour.start, "2026-02-16T05:00:00");
assert.equal(draftWithKanjiHour.end, "2026-02-16T06:00:00");

console.log("Date parsing checks: OK");
