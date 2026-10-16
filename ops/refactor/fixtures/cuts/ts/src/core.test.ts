import { expect, test } from "vitest"
import { publish } from "./core"

test("publish adds a run", () => {
  expect(publish("r/x", false)).toBe("ok:r/x")
})

test("publish amends a run", () => {
  expect(publish("r/x", true)).toBe("ok:r/x")
})

test("publish reports a failed add", () => {
  expect(publish("r/", false)).toBe("failed")
})

test("publish reports a failed amend", () => {
  expect(publish("r/", true)).toBe("failed")
})
