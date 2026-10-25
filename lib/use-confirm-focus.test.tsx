/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { useConfirmFocus } from "./use-confirm-focus";

// Mirrors the real confirm panels: trigger unmounts while the panel is open.
function Panel() {
  const [open, setOpen] = useState(false);
  const { triggerRef, titleRef } = useConfirmFocus(open);
  return open ? (
    <div>
      <p ref={titleRef} tabIndex={-1}>
        Sicher?
      </p>
      <button onClick={() => setOpen(false)}>Abbrechen</button>
    </div>
  ) : (
    <button ref={triggerRef} onClick={() => setOpen(true)}>
      Löschen
    </button>
  );
}

describe("useConfirmFocus", () => {
  it("does not steal focus on first render while closed", () => {
    render(<Panel />);
    expect(document.body).toHaveFocus();
  });

  it("focuses the panel title when the panel opens", () => {
    render(<Panel />);
    fireEvent.click(screen.getByText("Löschen"));
    expect(screen.getByText("Sicher?")).toHaveFocus();
  });

  it("returns focus to the trigger when the panel closes again", () => {
    render(<Panel />);
    fireEvent.click(screen.getByText("Löschen"));
    fireEvent.click(screen.getByText("Abbrechen"));
    expect(screen.getByText("Löschen")).toHaveFocus();
  });
});
