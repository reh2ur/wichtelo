import { Button, Section, Text } from "@react-email/components";
import { WichtelLayout } from "./components/wichtel-layout";
import { colors, muted, siteUrl, text } from "./components/theme";

export interface AccountInactivityWarningEmailProps {
  name: string;
  /** Human-readable German date, e.g. "30. November 2026". */
  deletionDate: string;
}

export function AccountInactivityWarningEmail({
  name,
  deletionDate,
}: AccountInactivityWarningEmailProps) {
  return (
    <WichtelLayout
      preview="Dein Wichtelo-Konto wird bald gelöscht"
      heading="Dein Konto wird bald gelöscht"
    >
      <Text style={text}>Hallo {name},</Text>
      <Text style={text}>
        du hast dich seit fast drei Jahren nicht mehr bei Wichtelo angemeldet.
        Aus Datenschutzgründen löschen wir Konten nach drei Jahren ohne
        Anmeldung. Dein Konto wird am {deletionDate} gelöscht, wenn du dich
        nicht vorher anmeldest.
      </Text>
      <Section style={{ margin: "0 0 20px" }}>
        <Button
          href={`${siteUrl}/anmelden`}
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
          Jetzt anmelden
        </Button>
      </Section>
      <Text style={muted}>
        Eine einzige Anmeldung genügt, um dein Konto zu behalten. Wenn du das
        Konto nicht mehr brauchst, musst du nichts tun.
      </Text>
    </WichtelLayout>
  );
}

export default AccountInactivityWarningEmail;
