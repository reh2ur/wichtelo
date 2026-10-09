/** Impressum operator identity, read from env so forks need no code edits. */
export type Operator = {
  name: string;
  addressLine1: string;
  addressLine2: string;
  contactEmail: string;
};

type Env = Record<string, string | undefined>;

// Production is guaranteed by `validateEnv`; dev/preview fall back to placeholders.
export function getOperator(env: Env = process.env): Operator {
  return {
    name: env.OPERATOR_NAME || "[OPERATOR_NAME]",
    addressLine1: env.OPERATOR_ADDRESS_LINE1 || "[OPERATOR_ADDRESS_LINE1]",
    addressLine2: env.OPERATOR_ADDRESS_LINE2 || "[OPERATOR_ADDRESS_LINE2]",
    contactEmail: env.OPERATOR_CONTACT_EMAIL || "kontakt@example.com",
  };
}
