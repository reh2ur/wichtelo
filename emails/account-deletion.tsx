import { Button, Section, Text } from "@react-email/components";
import { WichtelLayout } from "./components/wichtel-layout";
import { colors, muted, text } from "./components/theme";

export interface AccountDeletionEmailProps {
  confirmUrl: string;
}

export function AccountDeletionEmail({
  confirmUrl,
}: AccountDeletionEmailProps) {
  return (
    <WichtelLayout
      preview="Bestätige die Löschung deines Kontos"
      heading="Konto löschen"
    >
      <Text style={text}>
        Du hast die Löschung deines Kontos angefragt. Klicke auf den Button und
        bestätige auf der folgenden Seite, um dein Konto endgültig zu löschen.
        Der Link ist 24 Stunden gültig und kann nur einmal verwendet werden.
      </Text>
      <Section style={{ margin: "0 0 20px" }}>
        <Button
          href={confirmUrl}
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
          Konto löschen
        </Button>
      </Section>
      <Text style={muted}>
        Falls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail
        ignorieren. Dein Konto bleibt unverändert.
      </Text>
    </WichtelLayout>
  );
}

export default AccountDeletionEmail;
