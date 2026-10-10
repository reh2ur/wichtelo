import { Button, Section, Text } from "@react-email/components";
import { WichtelLayout } from "./components/wichtel-layout";
import { box, colors, siteUrl, text } from "./components/theme";

export interface DrawAssignmentEmailProps {
  groupName: string;
  groupSlug: string;
  year: number;
  giverName: string;
  receiverDisplayName: string;
  adminName: string | null;
  adminEmail: string | null;
  isRedraw: boolean;
}

export function DrawAssignmentEmail({
  groupName,
  groupSlug,
  year,
  giverName,
  receiverDisplayName,
  adminName,
  adminEmail,
  isRedraw,
}: DrawAssignmentEmailProps) {
  const heading = isRedraw ? "Neue Auslosung 🎁" : "Die Auslosung ist da! 🎁";

  return (
    <WichtelLayout
      preview={
        isRedraw
          ? `${groupName}: Neue Auslosung – öffne die E-Mail, um zu sehen, wen du jetzt beschenkst.`
          : `${groupName}: Die Auslosung ist da – öffne die E-Mail, um zu sehen, wen du beschenkst.`
      }
      heading={heading}
    >
      <Text style={text}>Hallo {giverName},</Text>
      <Text style={text}>
        {isRedraw ? (
          <>
            die Auslosung für <strong>{groupName}</strong> ({year}) wurde neu
            durchgeführt. Deine neue Zuteilung:
          </>
        ) : (
          <>
            die Auslosung für <strong>{groupName}</strong> ({year}) ist
            abgeschlossen. Deine Zuteilung:
          </>
        )}
      </Text>
      <Section style={box}>
        <Text
          style={{ ...text, margin: 0, fontSize: "13px", color: colors.muted }}
        >
          Du beschenkst:
        </Text>
        <Text
          style={{
            fontSize: "22px",
            fontWeight: 800,
            color: colors.navy,
            margin: "4px 0 0",
          }}
        >
          {receiverDisplayName}
        </Text>
      </Section>
      <Section style={{ margin: "0 0 20px" }}>
        <Button
          href={`${siteUrl}/gruppen/${encodeURIComponent(groupSlug)}`}
          style={{
            backgroundColor: colors.crimson,
            borderRadius: "20px",
            color: "#fffaf9",
            fontSize: "15px",
            fontWeight: 800,
            padding: "10px 24px",
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          Zur Gruppe
        </Button>
      </Section>
      {adminName && adminEmail && (
        <Text style={text}>
          Fragen zur Gruppe? Wende dich an {adminName} ({adminEmail}).
        </Text>
      )}
    </WichtelLayout>
  );
}

export default DrawAssignmentEmail;
