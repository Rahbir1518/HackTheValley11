/** Clerk is only wired in when keys are configured (see .env.example). */
export const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/** Local development only: ORDIS_DISABLE_AUTH=true opens the viewer without signing in. */
export const authDisabled = process.env.ORDIS_DISABLE_AUTH === "true" && process.env.NODE_ENV !== "production";
