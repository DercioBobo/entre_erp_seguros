import frappe
from frappe.utils import today

BATCH_SIZE = 500


def check_expired_policies():
    """
    Runs daily. Marks Active policies whose coverage_end_date has passed as Expired.

    Processes in batches of BATCH_SIZE to avoid memory pressure on large datasets.
    Uses db_set_value instead of doc.save() because Insurance Policy is a submitted
    document (docstatus=1) and save() would raise "Cannot edit submitted document"
    for fields that lack allow_on_submit=1.
    Each policy is committed individually so a single failure does not roll back
    the entire batch.
    """
    while True:
        # Fetch the next batch of still-active expired policies.
        # Because we update each one to "Expirada" before the next iteration,
        # the filter naturally advances without needing an offset.
        expired = frappe.db.get_all(
            "Insurance Policy",
            filters={
                "policy_status": "Activa",
                "coverage_end_date": ["<", today()],
            },
            pluck="name",
            limit=BATCH_SIZE,
            order_by="name asc",
        )

        if not expired:
            break

        for name in expired:
            try:
                frappe.db.set_value(
                    "Insurance Policy", name,
                    "policy_status", "Expirada",
                    update_modified=True,
                )
                frappe.db.commit()
            except Exception:
                frappe.log_error(
                    title=f"Erro ao expirar apólice {name}",
                    message=frappe.get_traceback(),
                )
                frappe.db.rollback()

        # If the batch was smaller than BATCH_SIZE, there are no more records.
        if len(expired) < BATCH_SIZE:
            break
