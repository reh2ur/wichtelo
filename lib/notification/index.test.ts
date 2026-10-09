import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();
const batchSendMock = vi.fn();

vi.mock("@/lib/email", () => ({
  resend: {
    emails: { send: (...args: unknown[]) => sendMock(...args) },
    batch: { send: (...args: unknown[]) => batchSendMock(...args) },
  },
  FROM_EMAIL: "wichtelo@test.local",
}));

const infoMock = vi.fn();
const errorMock = vi.fn();
const withMetadataMock = vi.fn().mockReturnValue({
  info: infoMock,
  error: errorMock,
});

vi.mock("@/lib/logger", () => ({
  logger: { withMetadata: (...args: unknown[]) => withMetadataMock(...args) },
}));

import { notify } from "./index";
import { DrawAssignmentEmail } from "@/emails/draw-assignment";
import { GroupDeletedEmail } from "@/emails/group-deleted";
import { ParticipantJoinedEmail } from "@/emails/participant-joined";
import { ParticipantLeftConfirmationEmail } from "@/emails/participant-left-confirmation";
import { ParticipantLeftAdminNoticeEmail } from "@/emails/participant-left-admin-notice";
import { AccountDeletionEmail } from "@/emails/account-deletion";
import { AccountDeletionConfirmedEmail } from "@/emails/account-deletion-confirmed";
import { AccountDeletionAdminNoticeEmail } from "@/emails/account-deletion-admin-notice";

beforeEach(() => {
  sendMock
    .mockReset()
    .mockResolvedValue({ data: { id: "email_1" }, error: null });
  batchSendMock
    .mockReset()
    .mockResolvedValue({ data: { data: [] }, error: null });
  infoMock.mockReset();
  errorMock.mockReset();
  withMetadataMock.mockReset().mockReturnValue({
    info: infoMock,
    error: errorMock,
  });
});

describe("notify draw delivery", () => {
  const base = {
    groupName: "Große Runde",
    groupSlug: "grosse-runde",
    year: 2026,
    adminName: "Anna Admin",
    adminEmail: "anna@example.com",
    groupId: "g1",
    drawKey: "3",
  };
  const recipients = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      to: `u${i}@example.com`,
      giverName: `U${i}`,
      receiverDisplayName: `R${i}`,
    }));

  it("chunks into batches of at most 100 with per-chunk idempotency keys", async () => {
    const result = await notify({
      type: "draw.completed",
      ...base,
      assignments: recipients(250),
    });

    expect(batchSendMock).toHaveBeenCalledTimes(3);
    expect(batchSendMock.mock.calls.map((c) => c[0].length)).toEqual([
      100, 100, 50,
    ]);
    expect(batchSendMock.mock.calls.map((c) => c[1])).toEqual([
      { idempotencyKey: "draw.completed:g1:3:0" },
      { idempotencyKey: "draw.completed:g1:3:1" },
      { idempotencyKey: "draw.completed:g1:3:2" },
    ]);
    expect(result).toEqual({ sent: 250, failed: 0 });
  });

  it("a single draw email uses emails.send with an idempotency key", async () => {
    await notify({
      type: "draw.redrawn",
      ...base,
      assignments: recipients(1),
    });
    expect(sendMock.mock.calls[0][1]).toEqual({
      idempotencyKey: "draw.redrawn:g1:3:0",
    });
  });

  it("reports failed chunks per recipient and still sends later chunks", async () => {
    batchSendMock
      .mockResolvedValueOnce({ data: null, error: { message: "invalid to" } })
      .mockResolvedValueOnce({ data: { data: [] }, error: null });

    const result = await notify({
      type: "draw.completed",
      ...base,
      assignments: recipients(130),
    });

    expect(batchSendMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 30, failed: 100 });
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  it("reports everything failed when Resend throws", async () => {
    batchSendMock.mockRejectedValueOnce(new Error("network"));
    const result = await notify({
      type: "draw.completed",
      ...base,
      assignments: recipients(5),
    });
    expect(result).toEqual({ sent: 0, failed: 5 });
  });

  it("non-draw events carry no idempotency key", async () => {
    await notify({
      type: "participant.joined",
      groupName: "X",
      participantName: "Y",
      adminEmails: ["a@example.com"],
    });
    expect(sendMock.mock.calls[0][1]).toBeUndefined();
  });
});

describe("notify", () => {
  it("draw.completed: batches one personalized email per assignment", async () => {
    await notify({
      type: "draw.completed",
      groupId: "g1",
      drawKey: "0",
      groupName: "Familie Muster",
      groupSlug: "familie-muster",
      year: 2026,
      adminName: "Anna Admin",
      adminEmail: "anna@example.com",
      assignments: [
        {
          to: "max@example.com",
          giverName: "Max",
          receiverDisplayName: "Anna",
        },
        { to: "eva@example.com", giverName: "Eva", receiverDisplayName: "Max" },
      ],
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(batchSendMock).toHaveBeenCalledTimes(1);
    const [payloads] = batchSendMock.mock.calls[0];
    expect(payloads).toHaveLength(2);
    expect(payloads[0].to).toBe("max@example.com");
    expect(payloads[0].from).toBe("wichtelo@test.local");
    expect(payloads[0].subject).toContain("Du bist dran!");
    expect(payloads[0].react.type).toBe(DrawAssignmentEmail);
    expect(payloads[0].react.props).toMatchObject({
      giverName: "Max",
      receiverDisplayName: "Anna",
      isRedraw: false,
    });
    expect(payloads[1].to).toBe("eva@example.com");
    expect(infoMock).toHaveBeenCalled();
    expect(withMetadataMock).toHaveBeenCalledWith({
      eventType: "draw.completed",
    });
  });

  it("draw.completed: still sends assignment emails when no admin contact resolved", async () => {
    await notify({
      type: "draw.completed",
      groupId: "g1",
      drawKey: "0",
      groupName: "Familie Muster",
      groupSlug: "familie-muster",
      year: 2026,
      adminName: null,
      adminEmail: null,
      assignments: [
        { to: "max@example.com", giverName: "Max", receiverDisplayName: "Eva" },
      ],
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0];
    expect(payload.to).toBe("max@example.com");
    expect(payload.react.props.adminName).toBeNull();
    expect(payload.react.props.adminEmail).toBeNull();
  });

  it("draw.redrawn: single assignment uses emails.send and marks isRedraw", async () => {
    await notify({
      type: "draw.redrawn",
      groupId: "g1",
      drawKey: "1",
      groupName: "Familie Muster",
      groupSlug: "familie-muster",
      year: 2026,
      adminName: "Anna Admin",
      adminEmail: "anna@example.com",
      assignments: [
        { to: "max@example.com", giverName: "Max", receiverDisplayName: "Eva" },
      ],
    });

    expect(batchSendMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0];
    expect(payload.to).toBe("max@example.com");
    expect(payload.subject).toContain("Neue Auslosung");
    expect(payload.react.type).toBe(DrawAssignmentEmail);
    expect(payload.react.props.isRedraw).toBe(true);
  });

  it("group.deleted: sends one email per recipient with admin contact", async () => {
    await notify({
      type: "group.deleted",
      groupName: "Büro Wichteln",
      year: 2026,
      adminName: "Anna Admin",
      adminEmail: "anna@example.com",
      recipients: [
        { to: "max@example.com", name: "Max" },
        { to: "eva@example.com", name: "Eva" },
      ],
    });

    expect(batchSendMock).toHaveBeenCalledTimes(1);
    const [payloads] = batchSendMock.mock.calls[0];
    expect(payloads).toHaveLength(2);
    expect(payloads[0].react.type).toBe(GroupDeletedEmail);
    expect(payloads[0].react.props.recipientName).toBe("Max");
  });

  it("group.deleted: still notifies recipients when no admin contact resolved", async () => {
    await notify({
      type: "group.deleted",
      groupName: "Büro Wichteln",
      year: 2026,
      adminName: null,
      adminEmail: null,
      recipients: [{ to: "max@example.com", name: "Max" }],
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0];
    expect(payload.react.props.adminName).toBeNull();
  });

  it("participant.joined: notifies all admins in one email", async () => {
    await notify({
      type: "participant.joined",
      groupName: "Familie Muster",
      participantName: "Max Mustermann",
      adminEmails: ["anna@example.com", "bert@example.com"],
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0];
    expect(payload.to).toEqual(["anna@example.com", "bert@example.com"]);
    expect(payload.react.type).toBe(ParticipantJoinedEmail);
    expect(payload.react.props.participantName).toBe("Max Mustermann");
  });

  it("participant.joined: sends nothing when there are no admins", async () => {
    await notify({
      type: "participant.joined",
      groupName: "Familie Muster",
      participantName: "Max Mustermann",
      adminEmails: [],
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(batchSendMock).not.toHaveBeenCalled();
  });

  it("participant.left: confirms to participant and notifies admins, with postDraw flag", async () => {
    await notify({
      type: "participant.left",
      groupName: "Familie Muster",
      participantName: "Max Mustermann",
      participantEmail: "max@example.com",
      postDraw: true,
      adminEmails: ["anna@example.com"],
    });

    expect(batchSendMock).toHaveBeenCalledTimes(1);
    const [payloads] = batchSendMock.mock.calls[0];
    expect(payloads).toHaveLength(2);
    expect(payloads[0].to).toBe("max@example.com");
    expect(payloads[0].react.type).toBe(ParticipantLeftConfirmationEmail);
    expect(payloads[1].to).toEqual(["anna@example.com"]);
    expect(payloads[1].react.type).toBe(ParticipantLeftAdminNoticeEmail);
    expect(payloads[1].react.props.postDraw).toBe(true);
  });

  it("participant.left: only confirms participant when there are no admins", async () => {
    await notify({
      type: "participant.left",
      groupName: "Familie Muster",
      participantName: "Max Mustermann",
      participantEmail: "max@example.com",
      postDraw: false,
      adminEmails: [],
    });

    expect(batchSendMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0];
    expect(payload.to).toBe("max@example.com");
    expect(payload.react.type).toBe(ParticipantLeftConfirmationEmail);
  });

  it("account.deletion_requested: sends confirm link mail and reports one sent", async () => {
    const ok = await notify({
      type: "account.deletion_requested",
      to: "max@example.com",
      confirmUrl: "https://wichtelo.example/konto/delete/confirm?token=t",
    });

    expect(ok).toEqual({ sent: 1, failed: 0 });
    const [payload] = sendMock.mock.calls[0];
    expect(payload.to).toBe("max@example.com");
    expect(payload.react.type).toBe(AccountDeletionEmail);
    expect(payload.react.props.confirmUrl).toContain("token=t");
  });

  it("notify reports failed when Resend fails", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "boom", name: "application_error" },
    });
    const ok = await notify({
      type: "account.deletion_requested",
      to: "max@example.com",
      confirmUrl: "https://wichtelo.example/x",
    });
    expect(ok).toEqual({ sent: 0, failed: 1 });
  });

  it("account.deletion_confirmed: sends confirmation to the deleted user", async () => {
    await notify({
      type: "account.deletion_confirmed",
      to: "max@example.com",
      name: "Max Mustermann",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0];
    expect(payload.to).toBe("max@example.com");
    expect(payload.react.type).toBe(AccountDeletionConfirmedEmail);
    expect(payload.react.props.name).toBe("Max Mustermann");
  });

  it("account.deletion_admin_notice: notifies affected group admins", async () => {
    await notify({
      type: "account.deletion_admin_notice",
      groupName: "Familie Muster",
      adminEmails: ["anna@example.com"],
      postDraw: false,
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [payload] = sendMock.mock.calls[0];
    expect(payload.to).toEqual(["anna@example.com"]);
    expect(payload.react.type).toBe(AccountDeletionAdminNoticeEmail);
    expect(payload.react.props.postDraw).toBe(false);
  });

  it("account.deletion_admin_notice: sends nothing when there are no admins", async () => {
    await notify({
      type: "account.deletion_admin_notice",
      groupName: "Familie Muster",
      adminEmails: [],
      postDraw: true,
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(batchSendMock).not.toHaveBeenCalled();
  });

  it("logs notification.failed and swallows the error when Resend fails", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "boom", name: "application_error" },
    });

    await expect(
      notify({
        type: "account.deletion_confirmed",
        to: "max@example.com",
        name: "Max",
      }),
    ).resolves.toEqual({ sent: 0, failed: 1 });

    expect(errorMock).toHaveBeenCalled();
    expect(infoMock).not.toHaveBeenCalled();
    const [metadata] = withMetadataMock.mock.calls[0];
    expect(metadata.eventType).toBe("account.deletion_confirmed");
    expect(metadata.reason).toContain("boom");
    expect(JSON.stringify(metadata)).not.toContain("max@example.com");
  });
});
