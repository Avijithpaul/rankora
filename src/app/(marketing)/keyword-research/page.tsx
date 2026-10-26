import type { Metadata } from "next";
import { FeaturePage, featureMetadata } from "../feature-page";

export const metadata: Metadata = featureMetadata("keyword-research");

export default function Page() {
  return <FeaturePage slug="keyword-research" />;
}
