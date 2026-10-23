"use client";

// Approve / reject / cancel / print for one document. The server re-checks every permission.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Printer, X, Ban } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  id: string;
  status: string;
  printCount: number;
  canApprove: boolean;
  /** The viewer prepared this document: approving it needs the owner override and a reason. */
  isCreator: boolean;
  canCancel: boolean;
  backHref: string;
}

export default function DocumentActions({ id, canApprove, isCreator, canCancel, backHref }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<"reject" | "cancel" | "approve" | null>(null);
  const [reason, setReason] = useState("");

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounting/documents/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      if (done) toast.success(done);
      setPending(null);
      setReason("");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function print() {
    window.print();
    await act({ action: "printed" }, "");
  }

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={backHref}><ArrowLeft className="mr-1 h-4 w-4" />Back</Link>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={print} disabled={busy}><Printer className="mr-1 h-4 w-4" />Print</Button>
          {canApprove && (<>
            <Button size="sm" onClick={() => (isCreator ? setPending("approve") : act({ action: "approve" }, "Approved and posted"))} disabled={busy}><Check className="mr-1 h-4 w-4" />Approve and post</Button>
            <Button size="sm" variant="outline" onClick={() => setPending("reject")} disabled={busy}><X className="mr-1 h-4 w-4" />Reject</Button>
          </>)}
          {canCancel && <Button size="sm" variant="destructive" onClick={() => setPending("cancel")} disabled={busy}><Ban className="mr-1 h-4 w-4" />Cancel document</Button>}
        </div>
      </div>
      {pending && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm">
            {pending === "cancel"
              ? "Cancelling reverses this document's journal and stock movements. Both the document and its reversal stay on record."
              : pending === "approve"
                ? "You prepared this document. Another administrator should approve it. Only the nominated owner may approve their own document, with a written reason that is kept in the history."
                : "The document will be marked rejected and will never post."}
          </p>
          <Textarea rows={2} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant={pending === "cancel" ? "destructive" : "default"} disabled={busy || !reason.trim()}
              onClick={() => (pending === "approve"
                ? act({ action: "approve", overrideReason: reason }, "Approved with owner override")
                : act({ action: pending, reason }, pending === "cancel" ? "Cancelled" : "Rejected"))}>
              Confirm {pending === "approve" ? "owner override" : pending}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Keep</Button>
          </div>
        </div>
      )}
    </div>
  );
}
