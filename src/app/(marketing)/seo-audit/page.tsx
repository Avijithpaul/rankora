import type { Metadata } from "next";
import { FeaturePage, featureMetadata } from "../feature-page";

export const metadata: Metadata = featureMetadata("seo-audit");

export default function Page() {
  return <FeaturePage slug="seo-audit" />;
}
