import { expect, test } from "vitest"
import { publish_all } from "./core"

test("publish_all records a run", () => {
  expect(publish_all("r/x")).toBe("ok:r/x")
})

test("publish_all reports a failure", () => {
  expect(publish_all("r/")).toBe("failed")
})
