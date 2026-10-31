import { BulkUpload } from "@/components/BulkUpload";

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="text-xl font-semibold">Bulk upload</h1>
      <p className="text-sm muted">For backlogs: drop hundreds of files or one ZIP. Each file becomes a document. Exact re-uploads are skipped automatically. Tips: docs/BACKLOG_MODE.md.</p>
      <BulkUpload />
    </div>
  );
}
