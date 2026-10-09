import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { colors, fontFamily, siteUrl } from "./theme";

export function WichtelLayout({
  preview,
  heading,
  children,
}: {
  preview: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <Html lang="de">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: colors.background,
          fontFamily,
          padding: "24px 0",
          margin: 0,
        }}
      >
        <Container
          style={{
            backgroundColor: colors.card,
            borderRadius: "16px",
            maxWidth: "480px",
            overflow: "hidden",
            border: `1px solid ${colors.border}`,
          }}
        >
          <Section
            style={{ backgroundColor: colors.navy, padding: "20px 32px" }}
          >
            <Text
              style={{
                color: "#ffffff",
                fontSize: "22px",
                fontWeight: 800,
                margin: 0,
              }}
            >
              ❄️ Wichtelo
            </Text>
          </Section>
          <Section style={{ padding: "28px 32px" }}>
            <Heading
              style={{
                color: colors.foreground,
                fontSize: "20px",
                fontWeight: 800,
                margin: "0 0 16px",
              }}
            >
              {heading}
            </Heading>
            {children}
          </Section>
          <Hr style={{ borderColor: colors.border, margin: 0 }} />
          <Section style={{ padding: "16px 32px" }}>
            <Text style={{ color: colors.muted, fontSize: "12px", margin: 0 }}>
              Diese E-Mail wurde automatisch von Wichtelo versendet.
            </Text>
            <Text
              style={{
                color: colors.muted,
                fontSize: "12px",
                margin: "8px 0 0",
              }}
            >
              <Link
                href={`${siteUrl}/impressum`}
                style={{ color: colors.muted }}
              >
                Impressum
              </Link>
              {" · "}
              <Link
                href={`${siteUrl}/datenschutz`}
                style={{ color: colors.muted }}
              >
                Datenschutz
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
