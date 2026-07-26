export type HostedIdentity = Readonly<{
  subject: string;
  name: string | null;
  email: string | null;
}>;

type SessionLike =
  | Readonly<{
      user?: Readonly<{
        id?: unknown;
        name?: unknown;
        email?: unknown;
      }> | null;
    }>
  | null
  | undefined;

export function hostedIdentityFromSession(
  session: SessionLike,
): HostedIdentity | null {
  const subject = session?.user?.id;
  if (typeof subject !== "string" || subject.trim() !== subject || !subject) {
    return null;
  }

  const name = session?.user?.name;
  const email = session?.user?.email;

  return {
    subject,
    name: typeof name === "string" && name ? name : null,
    email: typeof email === "string" && email ? email : null,
  };
}
