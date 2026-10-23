import assert from "node:assert/strict";
import { checkResult, requireResult } from "../../_shared/databaseResult.ts";

Deno.test("required database data rejects a null success before consumers use it", () => {
  assert.throws(() => requireResult({ data: null, error: null }), /Required database result is missing/);
});

Deno.test("required database data rejects an undefined success", () => {
  assert.throws(() => requireResult({ data: undefined, error: null }), /Required database result is missing/);
});

Deno.test("nullable database reads and write receipts retain a null success", () => {
  assert.equal(checkResult({ data: null, error: null }), null);
});

Deno.test("database errors take precedence over data and missing-data errors", () => {
  for (const read of [checkResult, requireResult]) {
    assert.throws(() => read({ data: null, error: { message: "database rejected the operation" } }), /database rejected the operation/);
    assert.throws(() => read({ data: { id: "row" }, error: { message: "database rejected the operation" } }), /database rejected the operation/);
  }
});

Deno.test("required database data preserves rows, empty lists and valid falsy values", () => {
  const row = { id: "row" };
  assert.equal(requireResult({ data: row, error: null }), row);
  assert.deepEqual(requireResult({ data: [], error: null }), []);
  assert.equal(requireResult({ data: false, error: null }), false);
  assert.equal(requireResult({ data: 0, error: null }), 0);
  assert.equal(requireResult({ data: "", error: null }), "");
});
