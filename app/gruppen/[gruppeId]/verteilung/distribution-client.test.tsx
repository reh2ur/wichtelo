/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/de.json";
import type { DistributionView } from "@/lib/draw/distribution";

vi.mock("./actions", () => ({ revealMemberName: vi.fn() }));

import { revealMemberName } from "./actions";
import {
  DistributionClient,
  DistributionProvider,
} from "./distribution-client";

const ok = {
  missingGiver: [],
  multipleGiver: [],
  missingReceiver: [],
  multipleReceiver: [],
  selfAssigned: [],
  mutualPairs: [],
  exclusionViolations: [],
  unknownEndpoints: 0,
  exclusionCount: 0,
  ok: true,
};

const view: DistributionView = {
  nodes: [
    { label: "A", isMe: true, ghost: false, name: "Ada Admin" },
    { label: "B", isMe: false, ghost: false },
    { label: "C", isMe: false, ghost: false },
  ],
  arrows: [
    { from: "A", to: "B" },
    { from: "B", to: "C" },
    { from: "C", to: "A" },
  ],
  check: ok,
};

function renderView(v: DistributionView = view) {
  return render(
    <DistributionProvider messages={messages}>
      <DistributionClient slug="grp" view={v} />
    </DistributionProvider>,
  );
}

const eyeB = () => screen.getByTestId("reveal-left-B");
const leftB = () => screen.getByTestId("person-left-B");

describe("DistributionClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(revealMemberName).mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows pseudonyms only, except the admin's own node", () => {
    renderView();
    expect(screen.getAllByText(/Ada Admin/).length).toBeGreaterThan(0);
    expect(leftB()).toHaveTextContent("Person B");
    expect(screen.queryByTestId("reveal-left-A")).toBeNull();
  });

  it("cancelling during the countdown never calls the server", async () => {
    renderView();
    fireEvent.click(eyeB());
    expect(leftB()).toHaveAttribute("data-state", "arming");

    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(eyeB());
    expect(leftB()).toHaveAttribute("data-state", "hidden");

    await act(async () => vi.advanceTimersByTime(5000));
    expect(revealMemberName).not.toHaveBeenCalled();
    expect(leftB()).toHaveTextContent("Person B");
  });

  it("reveals after 3 s in both columns, hides again, re-shows from cache", async () => {
    vi.mocked(revealMemberName).mockResolvedValue({
      status: "success",
      label: "B",
      name: "Bernd Becker",
    });
    renderView();

    fireEvent.click(eyeB());
    await act(async () => vi.advanceTimersByTime(2999));
    expect(revealMemberName).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(revealMemberName).toHaveBeenCalledWith("grp", "B");

    expect(leftB()).toHaveAttribute("data-state", "shown");
    expect(leftB()).toHaveTextContent("Bernd Becker");
    expect(screen.getByTestId("person-right-B")).toHaveTextContent(
      "Bernd Becker",
    );

    fireEvent.click(eyeB());
    expect(leftB()).toHaveTextContent("Person B");

    fireEvent.click(eyeB());
    await act(async () => vi.advanceTimersByTime(3000));
    expect(leftB()).toHaveTextContent("Bernd Becker");
    expect(revealMemberName).toHaveBeenCalledTimes(1);
  });

  it("shows an error and stays hidden when the server refuses", async () => {
    vi.mocked(revealMemberName).mockResolvedValue({
      status: "error",
      error: "rate_limited",
    });
    renderView();
    fireEvent.click(eyeB());
    await act(async () => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("alert")).toHaveTextContent("Zu viele Abfragen");
    expect(leftB()).toHaveAttribute("data-state", "hidden");
  });

  it("marks violating arrows and failed checks", () => {
    renderView({
      ...view,
      arrows: [
        { from: "A", to: "B" },
        { from: "B", to: "A" },
        { from: "C", to: "C" },
      ],
      check: {
        ...ok,
        ok: false,
        mutualPairs: [["A", "B"]],
        selfAssigned: ["C"],
      },
    });
    expect(screen.getByTestId("distribution-checks")).toHaveAttribute(
      "data-ok",
      "false",
    );
    expect(screen.getByTestId("check-noMutual")).toHaveAttribute(
      "data-ok",
      "false",
    );
    expect(screen.getByTestId("check-noSelf")).toHaveAttribute(
      "data-ok",
      "false",
    );
    expect(screen.getByTestId("arrow-A-B")).toHaveAttribute("data-bad", "true");
    expect(screen.getByTestId("arrow-C-C")).toHaveAttribute("data-bad", "true");
  });

  it("list view shows a row per person and flags a missing assignment", () => {
    renderView({ ...view, arrows: [{ from: "A", to: "B" }] });
    fireEvent.click(screen.getByRole("button", { name: "Liste" }));
    expect(screen.getAllByText("keine Zuweisung")).toHaveLength(2);
  });
});
