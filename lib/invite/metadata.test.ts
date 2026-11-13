import { describe, it, expect } from "vitest";
import { inviteMetadata } from "./metadata";

const t = (key: string, values?: Record<string, string>) =>
  values ? `${key}:${values.groupName}` : key;

describe("inviteMetadata", () => {
  it("open group: title includes group name + join description", () => {
    const m = inviteMetadata({ name: "XY", state: "open" }, t);
    expect(m.title).toBe("meta.title:XY");
    expect(m.description).toBe("meta.description");
    expect(m.openGraph?.title).toBe("meta.title:XY");
  });

  it("drawn group: neutral copy without join call-to-action", () => {
    const m = inviteMetadata({ name: "XY", state: "drawn" }, t);
    expect(m.title).toBe("meta.drawnTitle:XY");
    expect(m.description).toBe("meta.drawnDescription");
  });

  it("unknown token: generic preview", () => {
    const m = inviteMetadata(null, t);
    expect(m.title).toBe("meta.genericTitle");
    expect(m.description).toBe("meta.genericDescription");
  });
});
