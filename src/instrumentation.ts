/**
 * Boot-time configuration check.
 *
 * Runs once when the server starts. Without it a production deployment
 * missing SESSION_SECRET boots happily and fails on the first person who
 * tries to sign in — the problem surfaces to a user instead of to whoever
 * deployed it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const problems: string[] = [];

  if (process.env.NODE_ENV === "production") {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      problems.push("SESSION_SECRET is not set.");
    } else if (secret.length < 32) {
      problems.push("SESSION_SECRET must be at least 32 characters.");
    } else if (secret.includes("dev-only")) {
      problems.push("SESSION_SECRET still contains the development placeholder.");
    }
  }

  if (problems.length > 0) {
    // Refuse to serve rather than serve something insecure.
    console.error("\nCampOS cannot start:\n" + problems.map((p) => `  - ${p}`).join("\n") + "\n");
    throw new Error(`Invalid configuration: ${problems.join(" ")}`);
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[CampOS] Development mode: seeded demo accounts and the credential-free " +
        "sign-in endpoint are enabled. Both are disabled in production builds.",
    );
  }
}
