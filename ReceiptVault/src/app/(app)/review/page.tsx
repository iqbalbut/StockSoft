import { pageUser } from "@/lib/page-auth";
import { ReviewQueue } from "@/components/ReviewQueue";

export default async function ReviewPage() {
  const user = await pageUser();
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-2 text-xl font-semibold">Review</h1>
      <ReviewQueue readOnly={user.role !== "owner"} />
    </div>
  );
}
