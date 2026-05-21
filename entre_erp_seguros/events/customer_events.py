from frappe.utils import getdate, nowdate


def on_customer_validate(doc, method):
    if doc.get("customer_dob"):
        today = getdate(nowdate())
        dob = getdate(doc.customer_dob)
        doc.customer_age = (
            today.year - dob.year
            - ((today.month, today.day) < (dob.month, dob.day))
        )
