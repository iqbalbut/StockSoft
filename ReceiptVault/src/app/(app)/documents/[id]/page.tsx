import { notFound } from "next/navigation";
import { getDocument } from "@/pipeline/queries";
import { pageUser } from "@/lib/page-auth";
import { DocumentDetail } from "@/components/DocumentDetail";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser();
  const doc = await getDocument((await params).id);
  if (!doc) notFound();
  return <DocumentDetail initial={JSON.parse(JSON.stringify(doc))} readOnly={user.role !== "owner"} />;
}
