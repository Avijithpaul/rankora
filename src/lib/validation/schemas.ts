import { z } from "zod";
import { UnsafeUrlError, parsePublicUrl } from "@/lib/security/url-safety";
import { COUNTRIES, LANGUAGES } from "@/lib/locales";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address").max(254));

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(200),
});

const newPassword = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .regex(/[a-zA-Z]/, "Include at least one letter")
  .regex(/[0-9]/, "Include at least one number");

const fullName = z.string().trim().min(2, "Enter your name").max(120);

export const registerSchema = z.object({ fullName, email, password: newPassword });

export const forgotPasswordSchema = z.object({ email });

export const newPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

export const profileSchema = z.object({ fullName });

export const organizationSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "3–48 characters: lowercase letters, numbers and hyphens"),
});

const countryCodes = COUNTRIES.map((c) => c.code) as [string, ...string[]];
const languageCodes = LANGUAGES.map((l) => l.code) as [string, ...string[]];

/** Website URL: must be a syntactically public http(s) URL (DNS is checked again at crawl time). */
export const websiteUrl = z
  .string()
  .trim()
  .min(3, "Enter your website address")
  .max(2048)
  .transform((value, ctx) => {
    try {
      const url = parsePublicUrl(value);
      url.hash = "";
      url.search = "";
      if (!url.pathname) url.pathname = "/";
      return url;
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof UnsafeUrlError ? e.message : "Enter a valid URL" });
      return z.NEVER;
    }
  });

export const websiteSchema = z.object({
  name: z.string().trim().min(1, "Give the website a name").max(80),
  url: websiteUrl,
  countryCode: z.enum(countryCodes, "Choose a country"),
  languageCode: z.enum(languageCodes, "Choose a language"),
  preferredDomain: z.enum(["as_entered", "www", "non_www"]).default("as_entered"),
});

export const crawlSettingsSchema = z.object({
  maxPages: z.coerce.number().int().min(1).max(10000),
  maxDepth: z.coerce.number().int().min(0).max(20),
  crawlDelayMs: z.coerce.number().int().min(0).max(10000),
  respectRobotsTxt: z.coerce.boolean(),
  checkExternalLinks: z.coerce.boolean(),
  pagespeedEnabled: z.coerce.boolean(),
  crawlSchedule: z.enum(["manual", "daily", "weekly", "monthly"]),
  excludePatterns: z
    .string()
    .max(5000)
    .transform((s) =>
      s
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 50),
    ),
});

export type FieldErrors = Record<string, string[] | undefined>;

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: FieldErrors;
  /** echo of submitted values so forms can be re-populated */
  values?: Record<string, string>;
};

export function formValues(formData: FormData, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "")]));
}

export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  return z.flattenError(error).fieldErrors as FieldErrors;
}
