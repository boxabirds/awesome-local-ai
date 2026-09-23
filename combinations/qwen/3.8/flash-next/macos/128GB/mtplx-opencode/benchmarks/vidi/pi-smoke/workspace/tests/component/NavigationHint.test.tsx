import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NavigationHint, NAVIGATION_HINT_TEXT } from "@client/canvas/NavigationHint";

describe("nav.hint_display", () => {
  // TC-22
  it("TC-22 shows the hint while visible and removes it once navigation has happened", () => {
    const { rerender } = render(<NavigationHint visible />);
    expect(screen.getByTestId("navigation-hint")).toHaveTextContent(NAVIGATION_HINT_TEXT);
    // first camera change dismisses it
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId("navigation-hint")).toBeNull();
    // and it stays gone on further navigation
    rerender(<NavigationHint visible={false} />);
    expect(screen.queryByTestId("navigation-hint")).toBeNull();
  });
});
