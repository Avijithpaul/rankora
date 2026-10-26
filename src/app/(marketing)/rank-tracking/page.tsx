import type { Metadata } from "next";
import { FeaturePage, featureMetadata } from "../feature-page";

export const metadata: Metadata = featureMetadata("rank-tracking");

export default function Page() {
  return <FeaturePage slug="rank-tracking" />;
}
