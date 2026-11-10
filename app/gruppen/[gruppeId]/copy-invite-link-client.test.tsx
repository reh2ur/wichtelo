/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import messages from "@/messages/de.json";
import {
  CopyInviteLinkClient,
  GroupDetailProvider,
} from "./copy-invite-link-client";

describe("CopyInviteLinkClient", () => {
  it("reports failure when the legacy clipboard command fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    render(
      <GroupDetailProvider messages={messages}>
        <CopyInviteLinkClient inviteUrl="https://example.com/invite" />
      </GroupDetailProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /kopieren/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Kopieren fehlgeschlagen",
      ),
    );
    expect(screen.getByRole("textbox")).toHaveValue(
      "https://example.com/invite",
    );
  });
});
