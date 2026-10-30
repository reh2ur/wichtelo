import { describe, expect, it } from "vitest";
import { OTP_LENGTH, otpSchema } from "./otp";

describe("otpSchema", () => {
  it("accepts exactly OTP_LENGTH digits", () => {
    expect(OTP_LENGTH).toBe(8);
    expect(otpSchema.safeParse("12345678").success).toBe(true);
    expect(otpSchema.safeParse("00000000").success).toBe(true);
  });

  it.each(["123456", "1234567", "123456789", "", "1234567a", "1234 678"])(
    "rejects %j",
    (value) => {
      expect(otpSchema.safeParse(value).success).toBe(false);
    },
  );
});
