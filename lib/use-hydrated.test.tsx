/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { useHydrated } from "./use-hydrated";

function Probe() {
  return (
    <span data-testid="probe">{useHydrated() ? "hydrated" : "server"}</span>
  );
}

describe("useHydrated", () => {
  it("is false in the server render", () => {
    expect(renderToString(<Probe />)).toContain("server");
  });

  it("is true once rendered on the client", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("hydrated");
  });
});
