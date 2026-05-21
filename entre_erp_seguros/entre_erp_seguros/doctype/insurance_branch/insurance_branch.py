import frappe
from frappe.model.document import Document


class InsuranceBranch(Document):
    def validate(self):
        if self.branch_code:
            self.branch_code = self.branch_code.upper().strip()
