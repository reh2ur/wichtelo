import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Generic brand image: shared by every page incl. invite links, so it never
// carries group data.
export default async function OpengraphImage() {
  const t = await getTranslations("app");
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#b91c1c",
        color: "#ffffff",
      }}
    >
      <div style={{ fontSize: 120, fontWeight: 800 }}>{t("name")}</div>
      <div style={{ fontSize: 48, marginTop: 24 }}>{t("description")}</div>
    </div>,
    size,
  );
}
