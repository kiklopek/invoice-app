import type { Metadata } from "next";
import { SubscriptionClient } from "./subscription-client";

export const metadata: Metadata = { title: "Předplatné | Splatno" };

export default function SubscriptionPage() {
  return <SubscriptionClient />;
}
