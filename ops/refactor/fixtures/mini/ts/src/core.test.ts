import { expect, test } from "vitest"
import { titleOf } from "./core"

test("a run with a title shows it", () => {
  expect(titleOf({ title: "x" })).toBe("x")
})

test("a run without a title is untitled", () => {
  expect(titleOf({})).toBe("untitled")
})
