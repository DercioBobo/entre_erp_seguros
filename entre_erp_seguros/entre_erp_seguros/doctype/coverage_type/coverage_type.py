import frappe
from frappe import _
from frappe.model.document import Document


class CoverageType(Document):
    def validate(self):
        if self.min_capital and self.max_capital and self.min_capital > self.max_capital:
            frappe.throw(
                _("O capital mínimo ({0}) não pode ser maior que o capital máximo ({1}).").format(
                    self.min_capital, self.max_capital
                )
            )
