import { type AdminUser, displayName } from "@/lib/auth";
import { recordSourceAudit, type SourceAuditAction } from "@/lib/db";

// Records a source change against the acting admin. Called after the change
// has already been applied to Pinecone, so a failure here is logged rather
// than surfaced: the change happened and the request should report it.
export async function auditSourceChange(
  admin: AdminUser,
  change: {
    action: SourceAuditAction;
    filename: string;
    sourceName: string;
    url?: string | null;
  },
): Promise<void> {
  try {
    await recordSourceAudit({
      ...change,
      admin: { id: admin.id, email: admin.email, name: displayName(admin) },
    });
  } catch (err) {
    console.error(
      `Source audit write failed (${change.action} ${change.filename} by ${admin.email}):`,
      err,
    );
  }
}
